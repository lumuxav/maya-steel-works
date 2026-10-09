INSERT INTO public.expenses(description,category,amount,recorded_by)
VALUES ('Packing materials','Supplies',100,'11111111-1111-1111-1111-111111111111');
INSERT INTO public.bankings(banking_date,amount_banked,recorded_by,status,bank_or_method,expected_amount,variance)
VALUES ('2026-10-12',300,'11111111-1111-1111-1111-111111111111','pending','Cash deposit',300,0);

CREATE OR REPLACE FUNCTION public.fixture_fail_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.reason='FORCE_AUDIT_FAILURE' THEN
  RAISE EXCEPTION 'Simulated audit-log insertion failure';
 END IF;
 RETURN NEW;
END
$$;
CREATE TRIGGER fixture_audit_fault BEFORE INSERT ON public.corrections_log
FOR EACH ROW EXECUTE FUNCTION public.fixture_fail_audit();

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
DO $$
DECLARE v_result jsonb; v_amount numeric; v_count bigint;
BEGIN
 v_result:=public.maya_correct_record('expenses',1,'{"amount":250}',
 'Reviewed supplier invoice','00000000-0000-0000-0000-000000000201');
 PERFORM public.test_assert((v_result->>'changes')::integer=1,'one field changed');
 SELECT amount INTO v_amount FROM public.expenses WHERE id=1;
 PERFORM public.test_assert(v_amount=250,'expense correction committed');
 SELECT count(*) INTO v_count FROM public.corrections_log
 WHERE table_name='expenses' AND row_id=1 AND field_name='amount'
 AND old_value='100' AND new_value='250' AND changed_by=auth.uid();
 PERFORM public.test_assert(v_count=1,'expense correction has matching audit log');
 v_result:=public.maya_correct_record('expenses',1,'{"amount":250}',
 'Reviewed supplier invoice','00000000-0000-0000-0000-000000000201');
 SELECT count(*) INTO v_count FROM public.corrections_log WHERE table_name='expenses';
 PERFORM public.test_assert(v_count=1,'idempotent correction does not duplicate audit');
 BEGIN
   PERFORM public.maya_correct_record('expenses',1,'{"amount":300}',
    'FORCE_AUDIT_FAILURE','00000000-0000-0000-0000-000000000202');
   RAISE EXCEPTION 'Expected audit failure';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='Expected audit failure' THEN RAISE; END IF;
 END;
 SELECT amount INTO v_amount FROM public.expenses WHERE id=1;
 PERFORM public.test_assert(v_amount=250,'audit insertion failure rolled back expense edit');
 BEGIN
   PERFORM public.maya_correct_record('sales',1,'{"total_amount":1}',
    'Tamper with amount','00000000-0000-0000-0000-000000000203');
   RAISE EXCEPTION 'Expected financial sales field denial';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='Expected financial sales field denial' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.maya_correct_record('expenses',1,'{"amount":-5}',
    'Negative amount','00000000-0000-0000-0000-000000000204');
   RAISE EXCEPTION 'Expected negative expense denial';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='Expected negative expense denial' THEN RAISE; END IF;
 END;
END
$$;

SELECT public.maya_correct_record('sales',1,'{"customer_name":"Updated Alpha"}',
 'Corrected a customer typo','00000000-0000-0000-0000-000000000205');
DO $$
DECLARE v_name text; v_count bigint;
BEGIN
 SELECT customer_name INTO v_name FROM public.sales WHERE id=1;
 PERFORM public.test_assert(v_name='Updated Alpha','safe sale customer correction');
 SELECT count(*) INTO v_count FROM public.corrections_log WHERE table_name='sales' AND row_id=1;
 PERFORM public.test_assert(v_count=1,'sale correction history recorded');
 BEGIN
   PERFORM public.maya_correct_record('sales',4,'{"customer_name":"Changed Debtor"}',
     'Changing linked debtor','00000000-0000-0000-0000-000000000206');
   RAISE EXCEPTION 'Expected linked debt denial';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='Expected linked debt denial' THEN RAISE; END IF;
 END;
END
$$;

SELECT public.maya_correct_record('bankings',1,'{"amount_banked":270}',
 'Deposit slip corrected','00000000-0000-0000-0000-000000000207');
DO $$
DECLARE v_amt numeric; v_variance numeric; v_audit_count bigint;
BEGIN
 SELECT amount_banked,variance INTO v_amt,v_variance FROM public.bankings WHERE id=1;
 PERFORM public.test_assert(v_amt=270 AND v_variance=-30,'pending banking updates amount and variance together');
 SELECT count(*) INTO v_audit_count FROM public.corrections_log WHERE table_name='bankings' AND row_id=1;
 PERFORM public.test_assert(v_audit_count>=2,'all changing banking fields audited');
END
$$;
SELECT public.maya_correct_record('bankings',1,'{"status":"confirmed"}',
 'Banking confirmed by management','00000000-0000-0000-0000-000000000208');
DO $$
DECLARE v_status text; v_actor uuid; v_date timestamptz; v_count bigint;
BEGIN
 SELECT status,confirmed_by,confirmed_at INTO v_status,v_actor,v_date FROM public.bankings WHERE id=1;
 PERFORM public.test_assert(v_status='confirmed' AND v_actor=auth.uid() AND v_date IS NOT NULL,
 'bank confirmation and actor recorded atomically');
 SELECT count(*) INTO v_count FROM public.corrections_log WHERE table_name='bankings' AND field_name='status' AND row_id=1;
 PERFORM public.test_assert(v_count=1,'banking confirmation audit entry');
 BEGIN
   PERFORM public.maya_correct_record('bankings',1,'{"amount_banked":200}',
    'Trying to rewrite confirmed bank','00000000-0000-0000-0000-000000000209');
   RAISE EXCEPTION 'Expected confirmed banking denial';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='Expected confirmed banking denial' THEN RAISE; END IF;
 END;
END
$$;

DO $$
DECLARE v_count bigint;
BEGIN
 BEGIN
   TRUNCATE public.sales;
   RAISE EXCEPTION 'Expected truncate denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   UPDATE public.sales SET total_amount=1 WHERE id=1;
   RAISE EXCEPTION 'Expected direct sales update denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   DELETE FROM public.expenses WHERE id=1;
   RAISE EXCEPTION 'Expected direct expense delete denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   UPDATE public.bankings SET status='pending' WHERE id=1;
   RAISE EXCEPTION 'Expected direct banking update denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   INSERT INTO public.corrections_log(table_name,row_id,field_name,reason)
   VALUES('sales',1,'total_amount','forged');
   RAISE EXCEPTION 'Expected audit log forgery denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 SELECT count(*) INTO v_count FROM public.sales;
 PERFORM public.test_assert(v_count>0,'ledger rows retained after unauthorized attempts');
END
$$;

SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
DO $$
DECLARE v_count bigint;
BEGIN
 BEGIN
  PERFORM public.maya_correct_record('expenses',1,'{"description":"Employee takeover"}',
   'Employee unauthorized edit','00000000-0000-0000-0000-000000000210');
  RAISE EXCEPTION 'Expected employee correction denial';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Expected employee correction denial' THEN RAISE; END IF;
 END;
 SELECT count(*) INTO v_count FROM public.corrections_log WHERE changed_by=auth.uid();
 PERFORM public.test_assert(v_count=0,'employee cannot create privileged correction audit');
END
$$;

SELECT set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
DO $$
BEGIN
 BEGIN
  PERFORM public.maya_correct_record('bankings',1,'{"bank_or_method":"Abuse"}',
   'Disabled employee bypass','00000000-0000-0000-0000-000000000211');
  RAISE EXCEPTION 'Expected disabled correction denial';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Expected disabled correction denial' THEN RAISE; END IF;
 END;
END
$$;
RESET ROLE;
SELECT 'MAYA ATOMIC CORRECTIONS TESTS PASSED' AS result;
