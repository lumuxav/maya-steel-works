CREATE OR REPLACE FUNCTION public.maya_correct_record(
  p_table text,
  p_row_id bigint,
  p_changes jsonb,
  p_reason text,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_key text;
  v_before jsonb;
  v_after jsonb;
  v_payload jsonb;
  v_existing private.maya_operation_keys%ROWTYPE;
  v_result jsonb;
  v_changed_count integer := 0;
  v_new_date date;
BEGIN
  v_role := private.require_active_maya_user();
  IF v_role NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'Only Maya management can correct or confirm business records';
  END IF;
  IF p_table NOT IN ('sales','expenses','bankings') OR p_row_id IS NULL OR p_row_id<=0
     OR p_changes IS NULL OR jsonb_typeof(p_changes)<>'object'
     OR p_changes='{}'::jsonb OR p_request_id IS NULL
     OR length(btrim(coalesce(p_reason,'')))<6 THEN
    RAISE EXCEPTION 'Invalid correction; a reason of at least 6 characters is required';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_changes) LOOP
    IF (p_table='sales' AND v_key NOT IN ('customer_name','item_label'))
      OR (p_table='expenses' AND v_key NOT IN ('description','category','amount'))
      OR (p_table='bankings' AND v_key NOT IN ('bank_or_method','banking_date','amount_banked','status'))
    THEN
      RAISE EXCEPTION 'The % field of % cannot be changed directly. Use a documented business adjustment instead',v_key,p_table;
    END IF;
  END LOOP;
  IF p_table='bankings' AND p_changes ? 'status'
     AND (p_changes <> '{"status":"confirmed"}'::jsonb) THEN
    RAISE EXCEPTION 'Banking status can only change through confirmation';
  END IF;

  v_payload := jsonb_build_object('table',p_table,'id',p_row_id,'changes',p_changes,'reason',btrim(p_reason));
  INSERT INTO private.maya_operation_keys(id,actor_id,operation,input_data)
    VALUES(p_request_id,v_actor,'audit_correction',v_payload)
    ON CONFLICT(id) DO NOTHING;
  SELECT * INTO v_existing FROM private.maya_operation_keys
    WHERE id=p_request_id FOR UPDATE;
  IF v_existing.actor_id IS DISTINCT FROM v_actor
    OR v_existing.operation IS DISTINCT FROM 'audit_correction'
    OR v_existing.input_data IS DISTINCT FROM v_payload THEN
    RAISE EXCEPTION 'Correction request key cannot be reused with different details';
  END IF;
  IF v_existing.result IS NOT NULL THEN RETURN v_existing.result; END IF;

  IF p_table='sales' THEN
    SELECT to_jsonb(s) INTO v_before FROM public.sales s WHERE s.id=p_row_id FOR UPDATE;
    IF v_before IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
    IF p_changes ? 'customer_name' AND EXISTS(
      SELECT 1 FROM public.debt_events d WHERE d.sale_id=p_row_id
    ) THEN
      RAISE EXCEPTION 'Customer name on a sale with debt history requires a separate audited transfer';
    END IF;
    IF p_changes ? 'customer_name' AND
      (length(btrim(coalesce(p_changes->>'customer_name','')))<2
      OR length(btrim(p_changes->>'customer_name'))>200) THEN
      RAISE EXCEPTION 'Customer name must contain 2 to 200 characters';
    END IF;
    IF p_changes ? 'item_label' AND
      (length(btrim(coalesce(p_changes->>'item_label','')))<2
      OR length(btrim(p_changes->>'item_label'))>500) THEN
      RAISE EXCEPTION 'Item description must contain 2 to 500 characters';
    END IF;
    UPDATE public.sales
      SET customer_name=CASE WHEN p_changes ? 'customer_name' THEN btrim(p_changes->>'customer_name') ELSE customer_name END,
          item_label=CASE WHEN p_changes ? 'item_label' THEN btrim(p_changes->>'item_label') ELSE item_label END
      WHERE id=p_row_id;
    SELECT to_jsonb(s) INTO v_after FROM public.sales s WHERE s.id=p_row_id;

  ELSIF p_table='expenses' THEN
    SELECT to_jsonb(e) INTO v_before FROM public.expenses e WHERE e.id=p_row_id FOR UPDATE;
    IF v_before IS NULL THEN RAISE EXCEPTION 'Expense not found'; END IF;
    IF p_changes ? 'amount' AND (p_changes->>'amount')::numeric<=0 THEN
      RAISE EXCEPTION 'Expense amount must be greater than zero';
    END IF;
    IF p_changes ? 'description' AND
       length(btrim(coalesce(p_changes->>'description','')))<3 THEN
      RAISE EXCEPTION 'Expense description is too short';
    END IF;
    IF p_changes ? 'category' AND length(btrim(coalesce(p_changes->>'category','')))<1 THEN
      RAISE EXCEPTION 'Expense category cannot be blank';
    END IF;
    UPDATE public.expenses
      SET description=CASE WHEN p_changes ? 'description' THEN btrim(p_changes->>'description') ELSE description END,
          category=CASE WHEN p_changes ? 'category' THEN btrim(p_changes->>'category') ELSE category END,
          amount=CASE WHEN p_changes ? 'amount' THEN (p_changes->>'amount')::numeric ELSE amount END
      WHERE id=p_row_id;
    SELECT to_jsonb(e) INTO v_after FROM public.expenses e WHERE e.id=p_row_id;

  ELSE
    SELECT to_jsonb(b) INTO v_before FROM public.bankings b WHERE b.id=p_row_id FOR UPDATE;
    IF v_before IS NULL THEN RAISE EXCEPTION 'Banking not found'; END IF;
    IF v_before->>'status'='confirmed'
       AND (p_changes ? 'amount_banked' OR p_changes ? 'banking_date' OR p_changes ? 'status') THEN
      RAISE EXCEPTION 'Confirmed banking amounts and dates are locked to protect the cash archive';
    END IF;
    IF p_changes ? 'status' AND v_before->>'status'<>'pending' THEN
      RAISE EXCEPTION 'Only a pending banking can be confirmed';
    END IF;
    IF p_changes ? 'amount_banked' AND (p_changes->>'amount_banked')::numeric<=0 THEN
      RAISE EXCEPTION 'Banking amount must be positive';
    END IF;
    IF p_changes ? 'banking_date' THEN
      IF (p_changes->>'banking_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'Invalid banking date format';
      END IF;
      v_new_date := (p_changes->>'banking_date')::date;
      IF v_new_date<'2026-10-12'::date
        OR v_new_date>(now() AT TIME ZONE 'Africa/Kampala')::date THEN
        RAISE EXCEPTION 'Banking must fall on an existing Maya business day';
      END IF;
    END IF;
    IF p_changes ? 'bank_or_method' AND
      length(coalesce(p_changes->>'bank_or_method',''))>200 THEN
      RAISE EXCEPTION 'Banking method description is too long';
    END IF;
    UPDATE public.bankings
      SET bank_or_method=CASE WHEN p_changes ? 'bank_or_method' THEN nullif(btrim(p_changes->>'bank_or_method'),'') ELSE bank_or_method END,
          banking_date=CASE WHEN p_changes ? 'banking_date' THEN v_new_date ELSE banking_date END,
          amount_banked=CASE WHEN p_changes ? 'amount_banked' THEN (p_changes->>'amount_banked')::numeric ELSE amount_banked END,
          status=CASE WHEN p_changes ? 'status' THEN 'confirmed' ELSE status END,
          confirmed_by=CASE WHEN p_changes ? 'status' THEN v_actor ELSE confirmed_by END,
          confirmed_at=CASE WHEN p_changes ? 'status' THEN now() ELSE confirmed_at END,
          variance=CASE WHEN p_changes ? 'amount_banked' AND expected_amount IS NOT NULL
            THEN (p_changes->>'amount_banked')::numeric-expected_amount ELSE variance END,
          flagged=CASE WHEN p_changes ? 'amount_banked' AND expected_amount IS NOT NULL
            THEN abs((p_changes->>'amount_banked')::numeric-expected_amount)>=1 ELSE flagged END
      WHERE id=p_row_id;
    SELECT to_jsonb(b) INTO v_after FROM public.bankings b WHERE b.id=p_row_id;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_after) LOOP
    IF v_before->v_key IS DISTINCT FROM v_after->v_key THEN
      INSERT INTO public.corrections_log(table_name,row_id,field_name,old_value,new_value,reason,changed_by)
      VALUES(p_table,p_row_id,v_key,v_before->>v_key,v_after->>v_key,btrim(p_reason),v_actor);
      v_changed_count := v_changed_count + 1;
    END IF;
  END LOOP;
  IF v_changed_count=0 THEN RAISE EXCEPTION 'No changes were detected'; END IF;
  v_result := jsonb_build_object('table',p_table,'id',p_row_id,'changes',v_changed_count,'success',true);
  UPDATE private.maya_operation_keys SET result=v_result WHERE id=p_request_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.maya_correct_record(text,bigint,jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.maya_correct_record(text,bigint,jsonb,text,uuid) TO authenticated;

REVOKE UPDATE, DELETE ON TABLE public.sales, public.bankings, public.expenses FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.corrections_log FROM PUBLIC, anon, authenticated;

DO $$
DECLARE v_table record;
BEGIN
  FOR v_table IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table.relname);
  END LOOP;
END
$$;
