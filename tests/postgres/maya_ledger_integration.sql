CREATE FUNCTION public.test_assert(ok boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'TEST FAILED: %',message; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.test_assert(boolean,text) TO authenticated;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);

DO $$
DECLARE v_result jsonb; v_n numeric; v_count bigint; v_previous bigint;
BEGIN
 v_result := public.maya_ledger('sale', '{
   "item_type":"raw","item_id":1,"quantity":2,"unit_price":100,
   "payment_status":"paid","customer_name":"Alpha"
 }', '00000000-0000-0000-0000-000000000101');
 PERFORM public.test_assert((v_result->>'id')::bigint=1,'paid sale returns ID');
 SELECT quantity INTO v_n FROM public.raw_materials WHERE id=1;
 PERFORM public.test_assert(v_n=18,'sale stock deduction');
 SELECT count(*) INTO v_count FROM public.stock_movements;
 PERFORM public.test_assert(v_count=1,'one stock movement');
 v_result := public.maya_ledger('sale', '{
   "item_type":"raw","item_id":1,"quantity":2,"unit_price":100,
   "payment_status":"paid","customer_name":"Alpha"
 }', '00000000-0000-0000-0000-000000000101');
 PERFORM public.test_assert((v_result->>'id')::bigint=1,'idempotent sale request');
 SELECT count(*) INTO v_count FROM public.sales;
 PERFORM public.test_assert(v_count=1,'duplicate sale not inserted');
 BEGIN
   PERFORM public.maya_ledger('sale', '{"item_type":"raw"}',
    '00000000-0000-0000-0000-000000000101');
   RAISE EXCEPTION 'Expected idempotency mismatch';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='Expected idempotency mismatch' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.maya_ledger('sale','{
    "item_type":"raw","item_id":1,"quantity":999,"unit_price":100,
    "payment_status":"paid","customer_name":"Alpha"
  }','00000000-0000-0000-0000-000000000102');
  RAISE EXCEPTION 'Expected insufficient stock';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Expected insufficient stock' THEN RAISE; END IF;
 END;
 SELECT count(*) INTO v_count FROM public.sales;
 PERFORM public.test_assert(v_count=1,'failed sale rolled back fully');
END;
$$;

SELECT public.maya_ledger('sale', '{
  "item_type":"service","quantity":2,"unit_price":70,"payment_status":"credit",
  "customer_name":"Customer B","item_label":"Customer Material - Strips"
}', '00000000-0000-0000-0000-000000000103');
DO $$
DECLARE v_n numeric; v_count bigint;
BEGIN
 SELECT count(*) INTO v_count FROM public.sales WHERE item_type='service' AND item_id=0;
 PERFORM public.test_assert(v_count=1,'customer-owned service works without stock anchor');
 SELECT quantity INTO v_n FROM public.raw_materials WHERE id=1;
 PERFORM public.test_assert(v_n=18,'customer service does not deduct Maya material');
END;
$$;

SELECT public.maya_ledger('production', '{
  "recipe_id":1,"raw_id":1,"raw_units":2,"quantity":10,"scrap":0
}', '00000000-0000-0000-0000-000000000104');
DO $$
DECLARE v_n numeric; v_count bigint;
BEGIN
 SELECT quantity INTO v_n FROM public.raw_materials WHERE id=1;
 PERFORM public.test_assert(v_n=16,'production consumes raw material');
 SELECT quantity INTO v_n FROM public.finished_goods WHERE name='Louvers';
 PERFORM public.test_assert(v_n=10,'production adds finished goods');
 SELECT count(*) INTO v_count FROM public.production_log;
 PERFORM public.test_assert(v_count=1,'production log committed with stock movement');
END;
$$;

SELECT public.maya_ledger('make_sale', '{
  "recipe_id":1,"raw_id":1,"raw_units":1,"quantity":5,
  "unit_price":300,"payment_status":"paid","customer_name":"Alpha"
}', '00000000-0000-0000-0000-000000000105');
DO $$
DECLARE v_n numeric; v_count bigint;
BEGIN
 SELECT quantity INTO v_n FROM public.raw_materials WHERE id=1;
 PERFORM public.test_assert(v_n=15,'make-sell consumes raw');
 SELECT quantity INTO v_n FROM public.finished_goods WHERE name='Louvers';
 PERFORM public.test_assert(v_n=10,'make-sell produces and then sells exactly');
 SELECT count(*) INTO v_count FROM public.production_log;
 PERFORM public.test_assert(v_count=2,'make-sell creates production history');
 SELECT count(*) INTO v_count FROM public.sales WHERE item_type='finished';
 PERFORM public.test_assert(v_count=1,'make-sell creates finished sale');
END;
$$;

SELECT public.maya_ledger('sale', '{
 "item_type":"raw","item_id":1,"quantity":1,"unit_price":200,
 "payment_status":"credit","customer_name":"Debtor"
}', '00000000-0000-0000-0000-000000000106');
SELECT public.maya_ledger('payment', '{
 "customer_name":"Debtor","amount":50,"notes":"Partial repayment"
}', '00000000-0000-0000-0000-000000000107');
DO $$
DECLARE v_paid numeric; v_count bigint;
BEGIN
 SELECT amount_paid INTO v_paid FROM public.sales WHERE customer_name='Debtor';
 PERFORM public.test_assert(v_paid=50,'repayment updates outstanding invoice');
 SELECT count(*) INTO v_count FROM public.debt_events
 WHERE customer_name='Debtor' AND event_type='payment';
 PERFORM public.test_assert(v_count=1,'repayment posts exactly one ledger event');
END;
$$;
SELECT public.maya_ledger('payment', '{
 "customer_name":"Debtor","amount":50,"notes":"Partial repayment"
}', '00000000-0000-0000-0000-000000000107');
DO $$
DECLARE v_paid numeric;
BEGIN
 SELECT amount_paid INTO v_paid FROM public.sales WHERE customer_name='Debtor';
 PERFORM public.test_assert(v_paid=50,'replayed repayment did not charge twice');
 BEGIN
  PERFORM public.maya_ledger('adjustment','{"customer_name":"Debtor",
  "event_type":"compensation","amount":20}',
  '00000000-0000-0000-0000-000000000108');
  RAISE EXCEPTION 'Expected employee adjustment denial';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Expected employee adjustment denial' THEN RAISE; END IF;
 END;
END;
$$;

DO $$
DECLARE v_count bigint;
BEGIN
 UPDATE public.sales SET total_amount=1 WHERE customer_name='Debtor';
 GET DIAGNOSTICS v_count=ROW_COUNT;
 PERFORM public.test_assert(v_count=0,'employee cannot directly update sales ledger');
 BEGIN
  INSERT INTO public.sales(item_type,item_id,quantity,selling_price,total_amount,sold_by)
  VALUES('service',0,1,1,1,auth.uid());
  RAISE EXCEPTION 'Expected direct sale privilege denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.raw_materials(category,quantity) VALUES('Forged Stock',500);
  RAISE EXCEPTION 'Expected raw stock privilege denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.finished_goods(name,unit,quantity,selling_price) VALUES('Forged FG','pcs',500,1);
  RAISE EXCEPTION 'Expected finished stock privilege denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.deliveries(supplier_name,received_by) VALUES('Spoofed','22222222-2222-2222-2222-222222222222');
  RAISE EXCEPTION 'Expected delivery identity check';
 EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.debt_events(customer_name,event_type,amount)
  VALUES('Debtor','payment',999);
  RAISE EXCEPTION 'Expected direct debt-event privilege denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END;
$$;

SELECT set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
SELECT public.maya_ledger('adjustment', '{
  "event_type":"return","customer_name":"Debtor",
  "sale_id":4,"quantity":0.2
}', '00000000-0000-0000-0000-000000000109');
SELECT public.maya_ledger('adjustment', '{
  "event_type":"compensation","customer_name":"Debtor","amount":30
}', '00000000-0000-0000-0000-000000000110');
DO $$
DECLARE v_adj numeric; v_count bigint;
BEGIN
 SELECT adjustments INTO v_adj FROM public.sales WHERE customer_name='Debtor';
 PERFORM public.test_assert(v_adj=70,'return and compensation adjust debt correctly');
 SELECT count(*) INTO v_count FROM public.debt_events WHERE customer_name='Debtor' AND event_type IN ('return','compensation');
 PERFORM public.test_assert(v_count=2,'both adjustments audited');
END;
$$;

SELECT set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
DO $$
DECLARE v_count bigint;
BEGIN
 SELECT count(*) INTO v_count FROM public.sales;
 PERFORM public.test_assert(v_count=0,'disabled Maya user cannot read sales');
 BEGIN
  PERFORM public.maya_ledger('payment','{"customer_name":"Debtor","amount":10}',
  '00000000-0000-0000-0000-000000000111');
  RAISE EXCEPTION 'Expected disabled user denial';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Expected disabled user denial' THEN RAISE; END IF;
 END;
END;
$$;
RESET ROLE;
SELECT 'MAYA TESTS PASSED: atomic sales, production, credit, idempotency, and permission boundaries' AS result;
