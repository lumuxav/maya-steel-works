-- Maya stock trail: every addition and deduction says WHAT happened, WHY and WHICH record.
--
-- Before: production wrote "Maya production" on both the raw deduction and the finished-goods
-- addition, and a sale wrote "Maya sale". Nobody could tell from the stock history which
-- production run used which sheets, or which sale (and customer) took the goods out.
--
-- After (new rows):
--   raw       used_in_production  -3   "Production run #2: used 3 x Plain plates 0.8mm 4 x 8ft -> made 72 x Louvers 0.8mm 2inch x 8ft"
--   finished  produced           +72   "Production run #2: made from 3 x Plain plates 0.8mm 4 x 8ft"
--   finished  sold               -56   "Sale #5 to Customer"
--   raw       sold                -1   "Sale #6 to Customer"
-- Deliveries already store the delivery id; stocktakes already store the reason.
--
-- Also here:
--   * the same wording is back-filled onto the old generic notes (only rows whose note is
--     exactly "Maya production" / "Maya sale" and that match one production_log / sales row
--     by item and timestamp; quantities and balances are not touched);
--   * public.maya_stock_trail(): one read-only function that returns the whole stock history
--     with item names, who did it and a running balance, for the Stock Movements page.
--
-- No table, column or stock quantity changes. Safe to run more than once.
-- Deploy order: run this file in the Supabase SQL editor FIRST, then deploy the app.

-- 1. Production: write the run first so its number can go into both movement notes.
--    Everything else is identical to 20261105_maya_raw_stock_matching.sql.
CREATE OR REPLACE FUNCTION private.maya_produce(
  p_recipe_id bigint, p_raw_id bigint, p_used numeric, p_made numeric, p_scrap numeric, p_default_price numeric DEFAULT 0
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_recipe public.production_recipes%ROWTYPE;
  v_raw public.raw_materials%ROWTYPE;
  v_fg_id bigint;
  v_run_id bigint;
  v_raw_label text;
  v_fg_label text;
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
  IF NOT private.maya_raw_matches(v_raw.category, v_raw.gauge, v_raw.size_dimensions,
       v_recipe.raw_category, v_recipe.raw_gauge, v_recipe.raw_size) THEN
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
    VALUES (v_recipe.finished_name,v_recipe.raw_gauge,v_recipe.finished_size,'pieces',0,coalesce(p_default_price,0),'Maya Branch')
    RETURNING id INTO v_fg_id;
  END IF;

  INSERT INTO public.production_log(
    finished_good_id,boss_expected_yield,actual_yield,raw_material_id,
    fraction_of_material_used,raw_units_used,scrap_generated,employee_name)
  SELECT v_fg_id, v_recipe.yield_per_raw_unit*p_used,p_made,p_raw_id,
    p_used/nullif(v_raw.quantity,0),p_used,p_scrap,u.full_name
  FROM public.users u WHERE u.id=auth.uid()
  RETURNING id INTO v_run_id;

  v_raw_label := concat_ws(' ', nullif(btrim(v_raw.category),''), nullif(btrim(v_raw.gauge),''), nullif(btrim(v_raw.size_dimensions),''));
  SELECT concat_ws(' ', nullif(btrim(f.name),''), nullif(btrim(f.gauge),''), nullif(btrim(f.size_dimensions),''))
    INTO v_fg_label FROM public.finished_goods f WHERE f.id=v_fg_id;

  PERFORM private.deduct_stock_internal('raw',p_raw_id,p_used,'used_in_production',
    format('Production run #%s: used %s x %s -> made %s x %s',
           v_run_id, trim_scale(p_used), v_raw_label, trim_scale(p_made), v_fg_label));
  PERFORM private.add_stock_internal('finished',v_fg_id,p_made,'produced',
    format('Production run #%s: made from %s x %s', v_run_id, trim_scale(p_used), v_raw_label));
  RETURN v_fg_id;
END;
$$;
REVOKE ALL ON FUNCTION private.maya_produce(bigint,bigint,numeric,numeric,numeric,numeric) FROM PUBLIC, anon, authenticated;

-- 2. Sales: record the sale first so its number can go into the movement note.
--    Everything else is identical to the live public.maya_ledger. If the stock check fails the
--    whole call still rolls back, including the sale row, exactly as before.
CREATE OR REPLACE FUNCTION public.maya_ledger(p_operation text, p_data jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      v_item_id := private.maya_produce((v_request->>'recipe_id')::bigint,(v_request->>'raw_id')::bigint,v_used,v_qty,0,v_price);
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
    INSERT INTO public.sales(item_type,item_id,quantity,unit_price,selling_price,total_amount,
      amount_paid,payment_status,customer_name,sold_by,item_label)
    VALUES(v_item_type,v_item_id,v_qty,v_price,v_price,v_total,v_paid,v_status,v_customer,v_actor,v_label)
    RETURNING id INTO v_id;
    IF v_item_type<>'service' THEN
      PERFORM private.deduct_stock_internal(v_item_type,v_item_id,v_qty,'sold',
        format('Sale #%s to %s', v_id, v_customer));
    END IF;
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
$function$;

-- 3. Back-fill the old generic notes. Only the note text changes, and only on rows that still
--    say exactly "Maya production" / "Maya sale" and match one run / sale by item + timestamp.
UPDATE public.stock_movements m
SET notes = format('Production run #%s: used %s x %s -> made %s x %s',
      l.id, trim_scale(l.raw_units_used),
      concat_ws(' ', nullif(btrim(r.category),''), nullif(btrim(r.gauge),''), nullif(btrim(r.size_dimensions),'')),
      trim_scale(l.actual_yield),
      concat_ws(' ', nullif(btrim(f.name),''), nullif(btrim(f.gauge),''), nullif(btrim(f.size_dimensions),'')))
FROM public.production_log l
JOIN public.raw_materials r ON r.id = l.raw_material_id
JOIN public.finished_goods f ON f.id = l.finished_good_id
WHERE m.item_type='raw' AND m.item_id=l.raw_material_id
  AND m.movement_type='used_in_production' AND m.notes='Maya production'
  AND m.created_at=l.created_at AND l.raw_units_used IS NOT NULL;

UPDATE public.stock_movements m
SET notes = format('Production run #%s: made from %s x %s',
      l.id, trim_scale(l.raw_units_used),
      concat_ws(' ', nullif(btrim(r.category),''), nullif(btrim(r.gauge),''), nullif(btrim(r.size_dimensions),'')))
FROM public.production_log l
JOIN public.raw_materials r ON r.id = l.raw_material_id
WHERE m.item_type='finished' AND m.item_id=l.finished_good_id
  AND m.movement_type='produced' AND m.notes='Maya production'
  AND m.created_at=l.created_at AND l.raw_units_used IS NOT NULL;

UPDATE public.stock_movements m
SET notes = format('Sale #%s to %s', s.id, coalesce(nullif(btrim(s.customer_name),''),'Walk-in'))
FROM public.sales s
WHERE m.movement_type='sold' AND m.notes='Maya sale'
  AND m.item_type=s.item_type AND m.item_id=s.item_id
  AND m.created_at=s.created_at AND m.quantity_change=-s.quantity;

-- 4. The Stock Movements page. Whole stock history for Maya Branch, newest first, with the
--    item name, who did it and the balance of THAT item right after the movement (running
--    total over the item's full history, so it stays right even when the list is limited).
--    No cost columns, so it is safe for employees.
CREATE OR REPLACE FUNCTION public.maya_stock_trail(p_limit integer DEFAULT 500)
RETURNS TABLE(
  id bigint, created_at timestamptz, item_type text, item_id bigint, item_label text, unit text,
  movement_type text, quantity_change numeric, balance_after numeric, notes text,
  recorded_by_name text, reference_id bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_active_maya_user();
  RETURN QUERY
  WITH items AS (
    SELECT 'raw'::text AS t, r.id AS i,
           concat_ws(' ', nullif(btrim(r.category),''), nullif(btrim(r.gauge),''), nullif(btrim(r.size_dimensions),'')) AS label,
           r.unit::text AS unit
    FROM public.raw_materials r
    WHERE coalesce(r.current_branch,'Maya Branch')='Maya Branch'
    UNION ALL
    SELECT 'finished'::text, f.id,
           concat_ws(' ', nullif(btrim(f.name),''), nullif(btrim(f.gauge),''), nullif(btrim(f.size_dimensions),'')),
           f.unit::text
    FROM public.finished_goods f
    WHERE coalesce(f.current_branch,'Maya Branch')='Maya Branch'
  ), mv AS (
    SELECT m.id AS mid, m.created_at AS mat, m.item_type AS mtype, m.item_id AS mitem,
           m.movement_type AS mkind, m.quantity_change AS mchange, m.notes AS mnotes,
           m.recorded_by AS mby, m.reference_id AS mref,
           sum(m.quantity_change) OVER (PARTITION BY m.item_type, m.item_id ORDER BY m.created_at, m.id) AS bal
    FROM public.stock_movements m
  )
  SELECT mv.mid::bigint, mv.mat::timestamptz, mv.mtype::text, mv.mitem::bigint, it.label::text, it.unit::text,
         mv.mkind::text, mv.mchange::numeric, mv.bal::numeric, mv.mnotes::text,
         u.full_name::text, mv.mref::bigint
  FROM mv
  JOIN items it ON it.t = mv.mtype AND it.i = mv.mitem
  LEFT JOIN public.users u ON u.id = mv.mby
  WHERE mv.mkind NOT LIKE 'transfer\_%'
  ORDER BY mv.mat DESC, mv.mid DESC
  LIMIT greatest(1, least(coalesce(p_limit,500), 2000));
END;
$$;
REVOKE ALL ON FUNCTION public.maya_stock_trail(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maya_stock_trail(integer) TO authenticated;
