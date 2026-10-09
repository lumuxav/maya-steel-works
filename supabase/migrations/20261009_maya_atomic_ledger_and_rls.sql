CREATE TABLE IF NOT EXISTS private.maya_operation_keys (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  operation text NOT NULL,
  input_data jsonb NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.maya_operation_keys FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.maya_produce(
  p_recipe_id bigint, p_raw_id bigint, p_used numeric, p_made numeric, p_scrap numeric
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_recipe public.production_recipes%ROWTYPE;
  v_raw public.raw_materials%ROWTYPE;
  v_fg_id bigint;
  v_name text;
BEGIN
  PERFORM private.require_active_maya_user();
  IF p_recipe_id IS NULL OR p_raw_id IS NULL
    OR p_used IS NULL OR p_used <= 0 OR p_made IS NULL OR p_made <= 0
    OR p_scrap IS NULL OR p_scrap < 0 THEN
    RAISE EXCEPTION 'Invalid production quantities or recipe' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_recipe FROM public.production_recipes WHERE id=p_recipe_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production standard not found'; END IF;
  SELECT * INTO v_raw FROM public.raw_materials
   WHERE id=p_raw_id AND coalesce(current_branch,'Maya Branch')='Maya Branch' FOR UPDATE;
  IF NOT FOUND OR coalesce(v_raw.quantity,0) < p_used THEN
    RAISE EXCEPTION 'Insufficient Maya raw material';
  END IF;
  IF lower(v_raw.category) <> lower(v_recipe.raw_category)
    OR (coalesce(v_recipe.raw_gauge,'') <> '' AND position(lower(v_recipe.raw_gauge) in lower(coalesce(v_raw.gauge,''))) = 0)
    OR (coalesce(v_recipe.raw_size,'') <> '' AND position(lower(v_recipe.raw_size) in lower(coalesce(v_raw.size_dimensions,''))) = 0) THEN
    RAISE EXCEPTION 'Raw stock does not match the production standard';
  END IF;
  SELECT id INTO v_fg_id FROM public.finished_goods
  WHERE lower(name)=lower(v_recipe.finished_name)
    AND coalesce(gauge,'')=coalesce(v_recipe.raw_gauge,'')
    AND coalesce(size_dimensions,'')=coalesce(v_recipe.finished_size,'')
    AND coalesce(current_branch,'Maya Branch')='Maya Branch'
  ORDER BY id LIMIT 1 FOR UPDATE;
  IF v_fg_id IS NULL THEN
    INSERT INTO public.finished_goods(name,gauge,size_dimensions,unit,quantity,selling_price,current_branch)
    VALUES (v_recipe.finished_name,v_recipe.raw_gauge,v_recipe.finished_size,'pieces',0,0,'Maya Branch')
    RETURNING id INTO v_fg_id;
  END IF;
  PERFORM private.deduct_stock_internal('raw',p_raw_id,p_used,'used_in_production','Maya production');
  INSERT INTO public.production_log(
    finished_good_id,boss_expected_yield,actual_yield,raw_material_id,
    fraction_of_material_used,raw_units_used,scrap_generated,employee_name)
  SELECT v_fg_id, v_recipe.yield_per_raw_unit*p_used,p_made,p_raw_id,
    p_used/nullif(v_raw.quantity,0),p_used,p_scrap,u.full_name
  FROM public.users u WHERE u.id=auth.uid();
  PERFORM private.add_stock_internal('finished',v_fg_id,p_made,'produced','Maya production');
  RETURN v_fg_id;
END;
$$;
REVOKE ALL ON FUNCTION private.maya_produce(bigint,bigint,numeric,numeric,numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.maya_ledger(
  p_operation text, p_data jsonb, p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_old private.maya_operation_keys%ROWTYPE;
  v_result jsonb;
  v_id bigint;
  v_item_id bigint;
  v_item_type text;
  v_qty numeric;
  v_price numeric;
  v_total numeric;
  v_paid numeric;
  v_used numeric;
  v_sale public.sales%ROWTYPE;
  v_remaining numeric;
  v_applied numeric;
  v_adjusted numeric;
  v_label text;
  v_customer text;
  v_status text;
  v_note text;
  v_event text;
  v_request jsonb := coalesce(p_data,'{}'::jsonb);
BEGIN
  v_role := private.require_active_maya_user();
  IF p_operation NOT IN ('sale','make_sale','production','payment','adjustment')
     OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid Maya transaction or request key' USING ERRCODE='22023';
  END IF;
  INSERT INTO private.maya_operation_keys(id,actor_id,operation,input_data)
    VALUES(p_request_id,v_actor,p_operation,v_request)
    ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_old FROM private.maya_operation_keys WHERE id=p_request_id FOR UPDATE;
  IF v_old.actor_id IS DISTINCT FROM v_actor
    OR v_old.operation IS DISTINCT FROM p_operation
    OR v_old.input_data IS DISTINCT FROM v_request THEN
    RAISE EXCEPTION 'A request key cannot be reused for another transaction';
  END IF;
  IF v_old.result IS NOT NULL THEN RETURN v_old.result; END IF;

  IF p_operation IN ('sale','make_sale') THEN
    v_item_type := CASE WHEN p_operation='make_sale' THEN 'finished' ELSE v_request->>'item_type' END;
    v_qty := (v_request->>'quantity')::numeric;
    v_price := (v_request->>'unit_price')::numeric;
    v_status := v_request->>'payment_status';
    v_customer := coalesce(nullif(btrim(v_request->>'customer_name'),''),'Walk-in');
    IF v_item_type NOT IN ('raw','finished','service')
       OR v_qty IS NULL OR v_qty<=0 OR v_price IS NULL OR v_price<=0
       OR v_status NOT IN ('paid','partial','credit') THEN
      RAISE EXCEPTION 'Invalid sale details';
    END IF;
    IF v_item_type='service' AND (v_qty<>trunc(v_qty) OR p_operation='make_sale') THEN
      RAISE EXCEPTION 'Customer material must have a whole number of pieces';
    END IF;
    v_total := v_qty*v_price;
    v_paid := CASE WHEN v_status='paid' THEN v_total WHEN v_status='credit' THEN 0 ELSE (v_request->>'amount_paid')::numeric END;
    IF (v_status='partial' AND (v_paid IS NULL OR v_paid<=0 OR v_paid>=v_total)) THEN
      RAISE EXCEPTION 'Partial payment must be between zero and total';
    END IF;
    IF p_operation='make_sale' THEN
      v_used := (v_request->>'raw_units')::numeric;
      v_item_id := private.maya_produce((v_request->>'recipe_id')::bigint,(v_request->>'raw_id')::bigint,v_used,v_qty,0);
    ELSE
      v_item_id := coalesce((v_request->>'item_id')::bigint,0);
    END IF;
    IF v_item_type='raw' THEN
      SELECT trim(category||' '||coalesce(gauge,'')||' '||coalesce(size_dimensions,'')) INTO v_label
      FROM public.raw_materials WHERE id=v_item_id AND coalesce(current_branch,'Maya Branch')='Maya Branch';
    ELSIF v_item_type='finished' THEN
      SELECT trim(name||' '||coalesce(gauge,'')||' '||coalesce(size_dimensions,'')) INTO v_label
      FROM public.finished_goods WHERE id=v_item_id AND coalesce(current_branch,'Maya Branch')='Maya Branch';
    ELSE
      v_item_id := 0;
      v_label := v_request->>'item_label';
      IF v_label IS NULL OR v_label NOT LIKE 'Customer Material - %' OR length(v_label)>500 THEN
        RAISE EXCEPTION 'Invalid customer-owned-material service';
      END IF;
    END IF;
    IF v_label IS NULL THEN RAISE EXCEPTION 'Maya stock item not found'; END IF;
    IF v_item_type<>'service' THEN
      PERFORM private.deduct_stock_internal(v_item_type,v_item_id,v_qty,'sold','Maya sale');
    END IF;
    INSERT INTO public.sales(item_type,item_id,quantity,unit_price,selling_price,total_amount,
      amount_paid,payment_status,customer_name,sold_by,item_label)
    VALUES(v_item_type,v_item_id,v_qty,v_price,v_price,v_total,v_paid,v_status,v_customer,v_actor,v_label)
    RETURNING id INTO v_id;
    v_result := jsonb_build_object('id',v_id,'operation',p_operation);

  ELSIF p_operation='production' THEN
    v_item_id := private.maya_produce(
      (v_request->>'recipe_id')::bigint, (v_request->>'raw_id')::bigint,
      (v_request->>'raw_units')::numeric,(v_request->>'quantity')::numeric,
      coalesce((v_request->>'scrap')::numeric,0));
    v_result := jsonb_build_object('finished_good_id',v_item_id,'operation',p_operation);

  ELSIF p_operation='payment' THEN
    v_customer := btrim(v_request->>'customer_name');
    v_remaining := (v_request->>'amount')::numeric;
    v_note := nullif(v_request->>'notes','');
    IF v_customer IS NULL OR v_customer='' OR v_remaining IS NULL OR v_remaining<=0 THEN
      RAISE EXCEPTION 'Customer and positive payment amount required';
    END IF;
    v_total := v_remaining;
    FOR v_sale IN SELECT * FROM public.sales
      WHERE customer_name=v_customer
      ORDER BY created_at,id FOR UPDATE
    LOOP
      v_applied := least(greatest(0,v_sale.total_amount-coalesce(v_sale.amount_paid,0)-coalesce(v_sale.adjustments,0)),v_remaining);
      IF v_applied<=0 THEN CONTINUE; END IF;
      UPDATE public.sales SET amount_paid=coalesce(amount_paid,0)+v_applied WHERE id=v_sale.id;
      INSERT INTO public.debt_events(sale_id,customer_name,event_type,amount,received_by,notes)
      VALUES(v_sale.id,v_customer,'payment',v_applied,v_actor,v_note);
      v_remaining := v_remaining-v_applied;
      EXIT WHEN v_remaining<=0;
    END LOOP;
    IF v_remaining>0 THEN
      INSERT INTO public.debt_events(sale_id,customer_name,event_type,amount,received_by,notes)
      VALUES(null,v_customer,'payment',v_remaining,v_actor,
        concat_ws(' ',v_note,'(overpayment/advance)'));
    END IF;
    v_result := jsonb_build_object('amount',v_total,'operation',p_operation);

  ELSIF p_operation='adjustment' THEN
    IF v_role NOT IN ('admin','super_admin') THEN
      RAISE EXCEPTION 'Only Maya business administrators can adjust customer debt';
    END IF;
    v_event := v_request->>'event_type';
    v_customer := btrim(v_request->>'customer_name');
    v_note := nullif(v_request->>'notes','');
    IF v_customer IS NULL OR v_customer='' OR v_event NOT IN ('return','compensation') THEN
      RAISE EXCEPTION 'Invalid credit adjustment';
    END IF;
    IF v_event='return' THEN
      v_id := (v_request->>'sale_id')::bigint;
      v_qty := (v_request->>'quantity')::numeric;
      SELECT * INTO v_sale FROM public.sales WHERE id=v_id AND customer_name=v_customer FOR UPDATE;
      IF NOT FOUND OR v_qty IS NULL OR v_qty<=0 OR v_qty>v_sale.quantity THEN
        RAISE EXCEPTION 'Invalid return quantity or sale';
      END IF;
      SELECT coalesce(sum(quantity),0) INTO v_used FROM public.debt_events
      WHERE sale_id=v_id AND event_type='return';
      IF v_qty+v_used>v_sale.quantity THEN RAISE EXCEPTION 'Return exceeds sold quantity'; END IF;
      v_adjusted := least(v_qty*coalesce(v_sale.unit_price,v_sale.selling_price),
        greatest(0,v_sale.total_amount-coalesce(v_sale.amount_paid,0)-coalesce(v_sale.adjustments,0)));
    ELSE
      v_adjusted := (v_request->>'amount')::numeric;
      SELECT * INTO v_sale FROM public.sales
      WHERE customer_name=v_customer
        AND total_amount-coalesce(amount_paid,0)-coalesce(adjustments,0)>0
      ORDER BY created_at,id LIMIT 1 FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'No outstanding invoice to compensate'; END IF;
      v_id := v_sale.id;
      v_adjusted := least(v_adjusted,
        greatest(0,v_sale.total_amount-coalesce(v_sale.amount_paid,0)-coalesce(v_sale.adjustments,0)));
    END IF;
    IF v_adjusted IS NULL OR v_adjusted<=0 THEN
      RAISE EXCEPTION 'Adjustment must be positive and cannot exceed outstanding balance';
    END IF;
    UPDATE public.sales SET adjustments=coalesce(adjustments,0)+v_adjusted WHERE id=v_id;
    INSERT INTO public.debt_events(sale_id,customer_name,event_type,amount,item_label,quantity,received_by,notes)
    VALUES(v_id,v_customer,v_event,v_adjusted,v_sale.item_label,
      CASE WHEN v_event='return' THEN v_qty ELSE NULL END,v_actor,v_note);
    v_result := jsonb_build_object('amount',v_adjusted,'sale_id',v_id,'operation',p_operation);
  END IF;
  UPDATE private.maya_operation_keys SET result=v_result WHERE id=p_request_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.maya_ledger(text,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maya_ledger(text,jsonb,uuid) TO authenticated;

REVOKE INSERT ON public.sales FROM PUBLIC, authenticated;
REVOKE INSERT ON public.production_log FROM PUBLIC, authenticated;
REVOKE INSERT ON public.debt_events FROM PUBLIC, authenticated;
REVOKE INSERT ON public.stock_movements FROM PUBLIC, authenticated;
CREATE OR REPLACE FUNCTION private.maya_active_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id=auth.uid() AND active IS TRUE AND coalesce(branch,'Maya Branch')='Maya Branch'
  )
$$;
REVOKE ALL ON FUNCTION private.maya_active_member() FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.maya_active_member() TO authenticated;

DROP POLICY IF EXISTS sales_update_auth ON public.sales;
DROP POLICY IF EXISTS sales_update ON public.sales;
CREATE POLICY maya_sales_update_admin ON public.sales FOR UPDATE TO authenticated
USING (((select private.maya_active_member()) AND (select public.get_user_role()) IN ('admin','super_admin')))
WITH CHECK (((select private.maya_active_member()) AND (select public.get_user_role()) IN ('admin','super_admin')));
DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY maya_sales_select ON public.sales FOR SELECT TO authenticated
USING ((select private.maya_active_member()));
DROP POLICY IF EXISTS debt_select ON public.debt_events;
CREATE POLICY maya_debt_select ON public.debt_events FOR SELECT TO authenticated
USING ((select private.maya_active_member()));
DROP POLICY IF EXISTS debt_update ON public.debt_events;
CREATE POLICY maya_debt_update_admin ON public.debt_events FOR UPDATE TO authenticated
USING (((select private.maya_active_member()) AND (select public.get_user_role()) IN ('admin','super_admin')))
WITH CHECK (((select private.maya_active_member()) AND (select public.get_user_role()) IN ('admin','super_admin')));
DROP POLICY IF EXISTS bank_insert ON public.bankings;
CREATE POLICY maya_bank_insert ON public.bankings FOR INSERT TO authenticated
WITH CHECK (
  (select private.maya_active_member())
  AND recorded_by=(select auth.uid())
  AND status='pending' AND amount_banked>0
  AND banking_date>='2026-10-12'::date
);
DROP POLICY IF EXISTS exp_insert ON public.expenses;
CREATE POLICY maya_expense_insert ON public.expenses FOR INSERT TO authenticated
WITH CHECK (
  (select private.maya_active_member())
  AND recorded_by=(select auth.uid()) AND amount>0
);

DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT c.relname AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS maya_active_restrictive ON public.%I',v.name);
    EXECUTE format(
      'CREATE POLICY maya_active_restrictive ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
       USING ((select private.maya_active_member()))
       WITH CHECK ((select private.maya_active_member()))',v.name);
  END LOOP;
END
$$;
