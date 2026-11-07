-- Maya custom job: the customer picks stock, we cut / press / make it on the spot.
--
-- Until now the app could only (a) sell raw stock as it is, (b) sell finished goods, (c) make
-- goods from a production standard and sell them (Make & Sell), or (d) work on the customer's own
-- metal (Customer Material). It could not record "customer wants a half-sheet ribbed plate: take a
-- sheet from the store, use half, charge for the metal AND for the labour".
--
-- maya_ledger('custom_job', ...) records exactly that, in one all-or-nothing step:
--
--   * 1 to 8 stock items are taken off Maya Branch raw stock, in any quantity up to 3 decimals
--     (0.5 of a sheet is fine), for ANY raw item - plates, kibaati, channels, angles, louvers...
--   * every stock item becomes its own sales line (item_type 'raw', quantity x price), so costs,
--     the period report, the cash book and customer credit work exactly as for a normal raw sale;
--   * the labour becomes its own sales line (item_type 'service', "Labour - <description>"),
--     with no stock cost, so material and labour are separate on every report;
--   * all lines share a job number, shown in their labels: "... (job #12)";
--   * the stock history says why the stock went: "Custom job #12 for Alpha: used 0.5 x Plain
--     plates 1.2mm 4 x 8ft (Ribbed plate half sheet)" (movement type used_in_job);
--   * paid / partial / credit is split across the lines (material first, then labour), so a later
--     debt payment settles the right lines; credit and part payments need a customer name;
--   * a failed stock check, or any other error, leaves no sale line and no stock change;
--   * the same request key can never deduct twice (handled by maya_ledger, as for every operation).
--
-- Nothing else changes: no table or column is added; every other operation in maya_ledger is
-- identical to 20261106_maya_stock_trail.sql. Safe to run more than once.
-- Deploy order: run this file in the Supabase SQL editor FIRST, then deploy the app.

CREATE OR REPLACE FUNCTION private.maya_custom_job(p_request jsonb, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_desc text := btrim(coalesce(p_request->>'description',''));
  v_customer text := btrim(coalesce(p_request->>'customer_name',''));
  v_status text := p_request->>'payment_status';
  v_mats jsonb := p_request->'materials';
  v_labour numeric;
  v_paid_in numeric;
  v_n integer;
  v_i integer;
  v_elem jsonb;
  v_raw_id bigint;
  v_units numeric;
  v_price numeric;
  v_label text;
  v_raw_ids bigint[] := '{}';
  v_units_a numeric[] := '{}';
  v_prices numeric[] := '{}';
  v_labels text[] := '{}';
  v_totals numeric[] := '{}';
  v_sale_ids bigint[] := '{}';
  v_material_total numeric := 0;
  v_total numeric;
  v_paid numeric;
  v_pool numeric;
  v_line_paid numeric;
  v_job bigint;
  v_new_id bigint;
BEGIN
  IF length(v_desc) < 3 OR length(v_desc) > 200 THEN
    RAISE EXCEPTION 'Describe the job (3 to 200 characters)';
  END IF;
  IF v_status IS NULL OR v_status NOT IN ('paid','partial','credit') THEN
    RAISE EXCEPTION 'Invalid custom job payment status';
  END IF;
  BEGIN
    v_labour := coalesce(nullif(p_request->>'labour_amount',''),'0')::numeric;
    v_paid_in := nullif(p_request->>'amount_paid','')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Invalid custom job amounts';
  END;
  IF v_labour < 0 THEN RAISE EXCEPTION 'The labour charge cannot be negative'; END IF;
  IF jsonb_typeof(v_mats) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Add at least one stock item used in the job';
  END IF;
  v_n := jsonb_array_length(v_mats);
  IF v_n < 1 OR v_n > 8 THEN RAISE EXCEPTION 'A custom job needs 1 to 8 stock items'; END IF;
  IF v_status <> 'paid' AND v_customer = '' THEN
    RAISE EXCEPTION 'Enter the customer name for a credit or part-payment job';
  END IF;
  v_customer := coalesce(nullif(v_customer,''),'Walk-in');

  FOR v_i IN 0 .. v_n - 1 LOOP
    v_elem := v_mats -> v_i;
    BEGIN
      v_raw_id := (v_elem->>'raw_id')::bigint;
      v_units := (v_elem->>'raw_units')::numeric;
      v_price := (v_elem->>'unit_price')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Stock line % is not valid', v_i + 1;
    END;
    IF v_raw_id IS NULL OR v_units IS NULL OR v_price IS NULL OR v_units <= 0 OR v_price <= 0 THEN
      RAISE EXCEPTION 'Stock line % needs a stock item, a quantity and a price above zero', v_i + 1;
    END IF;
    IF round(v_units, 3) <> v_units THEN
      RAISE EXCEPTION 'Quantities can have at most 3 decimal places';
    END IF;
    SELECT concat_ws(' ', nullif(btrim(r.category),''), nullif(btrim(r.gauge),''), nullif(btrim(r.size_dimensions),''))
      INTO v_label FROM public.raw_materials r
     WHERE r.id = v_raw_id AND coalesce(r.current_branch,'Maya Branch') = 'Maya Branch';
    IF v_label IS NULL THEN RAISE EXCEPTION 'Maya stock item not found'; END IF;
    v_raw_ids := v_raw_ids || v_raw_id;
    v_units_a := v_units_a || v_units;
    v_prices := v_prices || v_price;
    v_labels := v_labels || v_label;
    v_totals := v_totals || (v_units * v_price);
    v_material_total := v_material_total + v_units * v_price;
  END LOOP;

  v_total := v_material_total + v_labour;
  v_paid := CASE v_status WHEN 'paid' THEN v_total WHEN 'credit' THEN 0 ELSE v_paid_in END;
  IF v_status = 'partial' AND (v_paid IS NULL OR v_paid <= 0 OR v_paid >= v_total) THEN
    RAISE EXCEPTION 'Partial payment must be between zero and total';
  END IF;
  v_pool := v_paid;

  -- One sales line per stock item. The first line's id is the job number.
  FOR v_i IN 1 .. v_n LOOP
    v_line_paid := least(v_totals[v_i], v_pool);
    v_pool := v_pool - v_line_paid;
    INSERT INTO public.sales(item_type,item_id,quantity,unit_price,selling_price,total_amount,
      amount_paid,payment_status,customer_name,sold_by,item_label)
    VALUES ('raw', v_raw_ids[v_i], v_units_a[v_i], v_prices[v_i], v_prices[v_i], v_totals[v_i],
      v_line_paid,
      CASE WHEN v_line_paid >= v_totals[v_i] THEN 'paid' WHEN v_line_paid <= 0 THEN 'credit' ELSE 'partial' END,
      v_customer, p_actor,
      v_labels[v_i] || CASE WHEN v_job IS NULL THEN '' ELSE ' (job #' || v_job || ')' END)
    RETURNING id INTO v_new_id;
    IF v_job IS NULL THEN
      v_job := v_new_id;
      UPDATE public.sales SET item_label = item_label || ' (job #' || v_job || ')' WHERE id = v_job;
    END IF;
    v_sale_ids := v_sale_ids || v_new_id;
  END LOOP;

  -- Labour is its own line, with no stock behind it.
  IF v_labour > 0 THEN
    v_line_paid := least(v_labour, v_pool);
    v_pool := v_pool - v_line_paid;
    INSERT INTO public.sales(item_type,item_id,quantity,unit_price,selling_price,total_amount,
      amount_paid,payment_status,customer_name,sold_by,item_label)
    VALUES ('service', 0, 1, v_labour, v_labour, v_labour, v_line_paid,
      CASE WHEN v_line_paid >= v_labour THEN 'paid' WHEN v_line_paid <= 0 THEN 'credit' ELSE 'partial' END,
      v_customer, p_actor, 'Labour - ' || v_desc || ' (job #' || v_job || ')')
    RETURNING id INTO v_new_id;
    v_sale_ids := v_sale_ids || v_new_id;
  END IF;

  -- Take the stock off last, so the history can name the job. Any failure undoes everything above.
  FOR v_i IN 1 .. v_n LOOP
    PERFORM private.deduct_stock_internal('raw', v_raw_ids[v_i], v_units_a[v_i], 'used_in_job',
      format('Custom job #%s for %s: used %s x %s (%s)',
             v_job, v_customer, trim_scale(v_units_a[v_i]), v_labels[v_i], v_desc));
  END LOOP;

  RETURN jsonb_build_object(
    'operation', 'custom_job', 'job_id', v_job, 'sale_ids', to_jsonb(v_sale_ids),
    'material_total', v_material_total, 'labour', v_labour, 'total', v_total,
    'amount_paid', v_paid, 'customer_name', v_customer);
END;
$$;
REVOKE ALL ON FUNCTION private.maya_custom_job(jsonb, uuid) FROM PUBLIC, anon, authenticated;

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
  IF p_operation NOT IN ('sale','make_sale','production','custom_job','payment','adjustment')
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

  ELSIF p_operation='custom_job' THEN
    v_result := private.maya_custom_job(v_request, v_actor);

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

-- The movement type used_in_job is free text in stock_movements; no table change is needed.
