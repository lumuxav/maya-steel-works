-- Regression tests for 20261107_maya_custom_job.sql (maya_ledger operation 'custom_job').
-- Runs after maya_stock_trail_integration.sql (see CI workflow). Start it from the repository root:
-- it re-runs the migration with \i at the end to prove the migration can be run twice.

RESET ROLE;

CREATE FUNCTION public.t_req(k integer) RETURNS uuid LANGUAGE sql IMMUTABLE
AS $$ SELECT ('00000000-0000-0000-0000-' || lpad(k::text, 12, '0'))::uuid $$;

-- Calls custom_job and asserts that it fails with a message matching `pat`.
CREATE FUNCTION public.t_expect_fail(p_data jsonb, k integer, pat text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.maya_ledger('custom_job', p_data, public.t_req(k));
    RAISE EXCEPTION 'TEST_DID_NOT_FAIL: wanted an error like %', pat;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST_DID_NOT_FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE pat THEN RAISE EXCEPTION 'Wrong error. Wanted like [%] but got [%]', pat, SQLERRM; END IF;
  END;
END
$$;

-- Stock: three Maya items (each with the "received" line a real delivery would leave) and one
-- item that belongs to another branch.
INSERT INTO public.raw_materials(id,category,gauge,size_dimensions,quantity)
  VALUES (9101,'Plain plates','1.2mm','4 x 8ft',10),
         (9102,'Ebibaati','1.5mm','8ft',20),
         (9103,'Z - Angles','3mm','20 ft',1);
INSERT INTO public.raw_materials(id,category,gauge,quantity,current_branch)
  VALUES (9104,'Plain','1mm',5,'Other Branch');
INSERT INTO public.stock_movements(item_type,item_id,movement_type,quantity_change,notes,recorded_by) VALUES
  ('raw',9101,'received',10,'Delivery received','22222222-2222-2222-2222-222222222222'),
  ('raw',9102,'received',20,'Delivery received','22222222-2222-2222-2222-222222222222'),
  ('raw',9103,'received',1,'Delivery received','22222222-2222-2222-2222-222222222222');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);

-- ---- 1. the example from the shop: half a sheet of plate, metal and labour charged separately ----
DO $$
DECLARE r jsonb; v_job bigint; v_qty numeric; s public.sales%ROWTYPE; l public.sales%ROWTYPE; m public.stock_movements%ROWTYPE;
BEGIN
 r := public.maya_ledger('custom_job',
  '{"description":"Ribbed plate (half sheet)","customer_name":"Alpha","materials":[{"raw_id":9101,"raw_units":0.5,"unit_price":100000}],"labour_amount":20000,"payment_status":"paid"}',
  public.t_req(701));
 v_job := (r->>'job_id')::bigint;
 PERFORM public.test_assert((r->>'total')::numeric=70000 AND (r->>'material_total')::numeric=50000 AND (r->>'labour')::numeric=20000,'result carries material, labour and total');
 PERFORM public.test_assert(jsonb_array_length(r->'sale_ids')=2,'a job with labour has two sales lines');

 SELECT quantity INTO v_qty FROM public.raw_materials WHERE id=9101;
 PERFORM public.test_assert(v_qty=9.5,'half a sheet came off stock: '||v_qty);

 SELECT * INTO s FROM public.sales WHERE id=v_job;
 PERFORM public.test_assert(s.item_type='raw' AND s.item_id=9101 AND s.quantity=0.5 AND s.unit_price=100000 AND s.total_amount=50000
   AND s.amount_paid=50000 AND s.payment_status='paid' AND s.customer_name='Alpha',
   'material line is an ordinary raw sale line (half a sheet at the sheet price)');
 PERFORM public.test_assert(s.item_label = format('Plain plates 1.2mm 4 x 8ft (job #%s)', v_job),'material label carries the job number: '||s.item_label);

 SELECT * INTO l FROM public.sales WHERE item_type='service' AND item_label LIKE '%(job #'||v_job||')';
 PERFORM public.test_assert(l.item_id=0 AND l.quantity=1 AND l.total_amount=20000 AND l.amount_paid=20000 AND l.payment_status='paid' AND l.customer_name='Alpha',
   'labour is its own service line, separate from the metal');
 PERFORM public.test_assert(l.item_label = format('Labour - Ribbed plate (half sheet) (job #%s)', v_job),'labour label: '||l.item_label);
 PERFORM public.test_assert(l.sold_by='11111111-1111-1111-1111-111111111111' AND s.sold_by=l.sold_by,'both lines belong to the person who recorded the job');

 SELECT * INTO m FROM public.stock_movements WHERE item_type='raw' AND item_id=9101 AND movement_type='used_in_job';
 PERFORM public.test_assert(m.quantity_change=-0.5,'stock history records the half sheet leaving');
 PERFORM public.test_assert(m.notes = format('Custom job #%s for Alpha: used 0.5 x Plain plates 1.2mm 4 x 8ft (Ribbed plate (half sheet))', v_job),'stock history explains the job: '||m.notes);
END;
$$;

-- ---- 2. blank customer on a fully paid job is a walk-in ----
DO $$
DECLARE r jsonb; s public.sales%ROWTYPE;
BEGIN
 r := public.maya_ledger('custom_job',
  '{"description":"Cut strips","customer_name":"  ","materials":[{"raw_id":9102,"raw_units":2,"unit_price":5000}],"labour_amount":0,"payment_status":"paid"}',
  public.t_req(702));
 SELECT * INTO s FROM public.sales WHERE id=(r->>'job_id')::bigint;
 PERFORM public.test_assert(s.customer_name='Walk-in','blank customer on a paid job is Walk-in');
 PERFORM public.test_assert(jsonb_array_length(r->'sale_ids')=1,'no labour charge means no labour line');
 PERFORM public.test_assert(NOT EXISTS (SELECT 1 FROM public.sales WHERE item_type='service' AND item_label LIKE '%(job #'||s.id||')'),'no service line was created for zero labour');
END;
$$;

-- ---- 3. credit and part payments need a customer, and a refused job leaves nothing behind ----
DO $$
DECLARE v_sales bigint; v_moves bigint; v_stock numeric;
BEGIN
 SELECT count(*) INTO v_sales FROM public.sales;
 SELECT count(*) INTO v_moves FROM public.stock_movements;
 SELECT quantity INTO v_stock FROM public.raw_materials WHERE id=9101;
 PERFORM public.t_expect_fail('{"description":"Half plate","customer_name":"","materials":[{"raw_id":9101,"raw_units":0.5,"unit_price":100000}],"labour_amount":5000,"payment_status":"credit"}', 703, 'Enter the customer name%');
 PERFORM public.t_expect_fail('{"description":"Half plate","materials":[{"raw_id":9101,"raw_units":0.5,"unit_price":100000}],"labour_amount":5000,"payment_status":"partial","amount_paid":1000}', 704, 'Enter the customer name%');
 PERFORM public.test_assert((SELECT count(*) FROM public.sales)=v_sales,'refused jobs leave no sales lines');
 PERFORM public.test_assert((SELECT count(*) FROM public.stock_movements)=v_moves,'refused jobs leave no stock movements');
 PERFORM public.test_assert((SELECT quantity FROM public.raw_materials WHERE id=9101)=v_stock,'refused jobs leave stock alone');
END;
$$;

-- ---- 4. credit: nothing paid on any line ----
DO $$
DECLARE r jsonb; v_job bigint; n integer;
BEGIN
 r := public.maya_ledger('custom_job',
  '{"description":"Kibaati cut to size","customer_name":"Beta","materials":[{"raw_id":9102,"raw_units":2,"unit_price":5000}],"labour_amount":5000,"payment_status":"credit"}',
  public.t_req(705));
 v_job := (r->>'job_id')::bigint;
 SELECT count(*) INTO n FROM public.sales WHERE customer_name='Beta' AND payment_status='credit' AND amount_paid=0
   AND item_label LIKE '%(job #'||v_job||')';
 PERFORM public.test_assert(n=2,'a credit job leaves both lines unpaid');
 PERFORM public.test_assert((r->>'total')::numeric=15000 AND (r->>'amount_paid')::numeric=0,'credit job totals');
END;
$$;

-- ---- 5. part payment is spread metal first, then labour ----
DO $$
DECLARE r jsonb; v_job bigint; mat public.sales%ROWTYPE; lab public.sales%ROWTYPE;
BEGIN
 -- paid 30,000 of 35,000 (metal 25,000 + labour 10,000): metal settled, labour part-paid
 r := public.maya_ledger('custom_job',
  '{"description":"Quarter plate","customer_name":"Gamma","materials":[{"raw_id":9101,"raw_units":0.25,"unit_price":100000}],"labour_amount":10000,"payment_status":"partial","amount_paid":30000}',
  public.t_req(706));
 v_job := (r->>'job_id')::bigint;
 SELECT * INTO mat FROM public.sales WHERE id=v_job;
 SELECT * INTO lab FROM public.sales WHERE item_type='service' AND item_label LIKE '%(job #'||v_job||')';
 PERFORM public.test_assert(mat.amount_paid=25000 AND mat.payment_status='paid','metal line is settled first');
 PERFORM public.test_assert(lab.amount_paid=5000 AND lab.payment_status='partial','labour line takes the rest as a part payment');

 -- paid 20,000 of 35,000: metal part-paid, labour not paid at all
 r := public.maya_ledger('custom_job',
  '{"description":"Quarter plate","customer_name":"Delta","materials":[{"raw_id":9101,"raw_units":0.25,"unit_price":100000}],"labour_amount":10000,"payment_status":"partial","amount_paid":20000}',
  public.t_req(707));
 v_job := (r->>'job_id')::bigint;
 SELECT * INTO mat FROM public.sales WHERE id=v_job;
 SELECT * INTO lab FROM public.sales WHERE item_type='service' AND item_label LIKE '%(job #'||v_job||')';
 PERFORM public.test_assert(mat.amount_paid=20000 AND mat.payment_status='partial','metal line part-paid');
 PERFORM public.test_assert(lab.amount_paid=0 AND lab.payment_status='credit','labour line still owed');
 PERFORM public.test_assert((SELECT sum(amount_paid) FROM public.sales WHERE item_label LIKE '%(job #'||v_job||')')=(r->>'amount_paid')::numeric,'lines add up to the amount paid');
END;
$$;

DO $$
BEGIN
 PERFORM public.t_expect_fail('{"description":"Quarter plate","customer_name":"Gamma","materials":[{"raw_id":9101,"raw_units":0.25,"unit_price":100000}],"labour_amount":10000,"payment_status":"partial","amount_paid":35000}', 708, 'Partial payment must be between zero and total');
 PERFORM public.t_expect_fail('{"description":"Quarter plate","customer_name":"Gamma","materials":[{"raw_id":9101,"raw_units":0.25,"unit_price":100000}],"labour_amount":10000,"payment_status":"partial","amount_paid":0}', 709, 'Partial payment must be between zero and total');
 PERFORM public.t_expect_fail('{"description":"Quarter plate","customer_name":"Gamma","materials":[{"raw_id":9101,"raw_units":0.25,"unit_price":100000}],"labour_amount":10000,"payment_status":"partial"}', 710, 'Partial payment must be between zero and total');
END;
$$;

-- ---- 6. more than one stock item in a job (plate + kibaati), no labour ----
DO $$
DECLARE r jsonb; v_job bigint; v_q1 numeric; v_q2 numeric; n integer;
BEGIN
 SELECT quantity INTO v_q1 FROM public.raw_materials WHERE id=9101;
 SELECT quantity INTO v_q2 FROM public.raw_materials WHERE id=9102;
 r := public.maya_ledger('custom_job',
  '{"description":"Louver frame","customer_name":"Epsilon","materials":[{"raw_id":9101,"raw_units":0.25,"unit_price":100000},{"raw_id":9102,"raw_units":3,"unit_price":5000}],"labour_amount":0,"payment_status":"paid"}',
  public.t_req(711));
 v_job := (r->>'job_id')::bigint;
 PERFORM public.test_assert((r->>'total')::numeric=40000,'two stock items add up');
 SELECT count(*) INTO n FROM public.sales WHERE item_label LIKE '%(job #'||v_job||')';
 PERFORM public.test_assert(n=2,'each stock item has its own line, all tagged with the job number');
 PERFORM public.test_assert((SELECT quantity FROM public.raw_materials WHERE id=9101)=v_q1-0.25,'first item deducted');
 PERFORM public.test_assert((SELECT quantity FROM public.raw_materials WHERE id=9102)=v_q2-3,'second item deducted');
 SELECT count(*) INTO n FROM public.stock_movements WHERE movement_type='used_in_job' AND notes LIKE 'Custom job #'||v_job||' for Epsilon:%';
 PERFORM public.test_assert(n=2,'each stock item has its own explained movement');
END;
$$;

-- ---- 7. not enough stock: everything is undone, even the lines that would have fitted ----
DO $$
DECLARE v_sales bigint; v_moves bigint; v_q1 numeric; v_q3 numeric;
BEGIN
 SELECT count(*) INTO v_sales FROM public.sales;
 SELECT count(*) INTO v_moves FROM public.stock_movements;
 SELECT quantity INTO v_q1 FROM public.raw_materials WHERE id=9101;
 SELECT quantity INTO v_q3 FROM public.raw_materials WHERE id=9103;
 PERFORM public.t_expect_fail('{"description":"Too much","customer_name":"Zeta","materials":[{"raw_id":9103,"raw_units":2,"unit_price":1000}],"labour_amount":0,"payment_status":"paid"}', 712, 'Insufficient stock%');
 PERFORM public.t_expect_fail('{"description":"Half fits, second does not","customer_name":"Zeta","materials":[{"raw_id":9101,"raw_units":0.5,"unit_price":100000},{"raw_id":9103,"raw_units":5,"unit_price":1000}],"labour_amount":1000,"payment_status":"paid"}', 713, 'Insufficient stock%');
 PERFORM public.t_expect_fail('{"description":"Same item twice","customer_name":"Zeta","materials":[{"raw_id":9103,"raw_units":1,"unit_price":1000},{"raw_id":9103,"raw_units":1,"unit_price":1000}],"labour_amount":0,"payment_status":"paid"}', 714, 'Insufficient stock%');
 PERFORM public.test_assert((SELECT count(*) FROM public.sales)=v_sales,'a failed job leaves no sales lines');
 PERFORM public.test_assert((SELECT count(*) FROM public.stock_movements)=v_moves,'a failed job leaves no stock movements');
 PERFORM public.test_assert((SELECT quantity FROM public.raw_materials WHERE id=9101)=v_q1,'the item that did fit was not touched');
 PERFORM public.test_assert((SELECT quantity FROM public.raw_materials WHERE id=9103)=v_q3,'the short item was not touched');
END;
$$;

-- ---- 8. input checks ----
DO $$
BEGIN
 PERFORM public.t_expect_fail('{"description":"Stock from another branch","materials":[{"raw_id":9104,"raw_units":1,"unit_price":1000}],"payment_status":"paid"}', 720, 'Maya stock item not found');
 PERFORM public.t_expect_fail('{"description":"No such item","materials":[{"raw_id":987654,"raw_units":1,"unit_price":1000}],"payment_status":"paid"}', 721, 'Maya stock item not found');
 PERFORM public.t_expect_fail('{"description":"ab","materials":[{"raw_id":9102,"raw_units":1,"unit_price":1000}],"payment_status":"paid"}', 722, 'Describe the job%');
 PERFORM public.t_expect_fail('{"materials":[{"raw_id":9102,"raw_units":1,"unit_price":1000}],"payment_status":"paid"}', 723, 'Describe the job%');
 PERFORM public.t_expect_fail('{"description":"Zero quantity","materials":[{"raw_id":9102,"raw_units":0,"unit_price":1000}],"payment_status":"paid"}', 724, 'Stock line 1 needs%');
 PERFORM public.t_expect_fail('{"description":"Negative quantity","materials":[{"raw_id":9102,"raw_units":-1,"unit_price":1000}],"payment_status":"paid"}', 725, 'Stock line 1 needs%');
 PERFORM public.t_expect_fail('{"description":"Zero price","materials":[{"raw_id":9102,"raw_units":1,"unit_price":0}],"payment_status":"paid"}', 726, 'Stock line 1 needs%');
 PERFORM public.t_expect_fail('{"description":"No price","materials":[{"raw_id":9102,"raw_units":1}],"payment_status":"paid"}', 727, 'Stock line 1 needs%');
 PERFORM public.t_expect_fail('{"description":"Four decimals","materials":[{"raw_id":9102,"raw_units":0.0001,"unit_price":1000}],"payment_status":"paid"}', 728, 'Quantities can have at most 3 decimal places');
 PERFORM public.t_expect_fail('{"description":"Not a number","materials":[{"raw_id":"abc","raw_units":1,"unit_price":1000}],"payment_status":"paid"}', 729, 'Stock line 1 is not valid');
 PERFORM public.t_expect_fail('{"description":"Second line bad","materials":[{"raw_id":9102,"raw_units":1,"unit_price":1000},{"raw_id":9102,"raw_units":"x","unit_price":1000}],"payment_status":"paid"}', 730, 'Stock line 2 is not valid');
 PERFORM public.t_expect_fail('{"description":"No stock","materials":[],"payment_status":"paid"}', 731, 'A custom job needs 1 to 8 stock items');
 PERFORM public.t_expect_fail('{"description":"No stock key","payment_status":"paid"}', 732, 'Add at least one stock item%');
 PERFORM public.t_expect_fail('{"description":"Stock is not a list","materials":{"raw_id":9102},"payment_status":"paid"}', 733, 'Add at least one stock item%');
 PERFORM public.t_expect_fail(jsonb_build_object('description','Nine items','payment_status','paid',
   'materials',(SELECT jsonb_agg(jsonb_build_object('raw_id',9102,'raw_units',0.001,'unit_price',1000)) FROM generate_series(1,9))), 734, 'A custom job needs 1 to 8 stock items');
 PERFORM public.t_expect_fail('{"description":"Negative labour","materials":[{"raw_id":9102,"raw_units":1,"unit_price":1000}],"labour_amount":-1,"payment_status":"paid"}', 735, 'The labour charge cannot be negative');
 PERFORM public.t_expect_fail('{"description":"Bad labour","materials":[{"raw_id":9102,"raw_units":1,"unit_price":1000}],"labour_amount":"lots","payment_status":"paid"}', 736, 'Invalid custom job amounts');
 PERFORM public.t_expect_fail('{"description":"Bad status","materials":[{"raw_id":9102,"raw_units":1,"unit_price":1000}],"payment_status":"later"}', 737, 'Invalid custom job payment status');
 PERFORM public.t_expect_fail('{"description":"No status","materials":[{"raw_id":9102,"raw_units":1,"unit_price":1000}]}', 738, 'Invalid custom job payment status');
END;
$$;

-- ---- 9. the same request can never take stock twice ----
DO $$
DECLARE a jsonb; b jsonb; v_q numeric; v_sales bigint;
BEGIN
 SELECT quantity INTO v_q FROM public.raw_materials WHERE id=9102;
 a := public.maya_ledger('custom_job',
  '{"description":"Retry safe","customer_name":"Eta","materials":[{"raw_id":9102,"raw_units":1,"unit_price":5000}],"labour_amount":2000,"payment_status":"paid"}', public.t_req(740));
 SELECT count(*) INTO v_sales FROM public.sales;
 b := public.maya_ledger('custom_job',
  '{"description":"Retry safe","customer_name":"Eta","materials":[{"raw_id":9102,"raw_units":1,"unit_price":5000}],"labour_amount":2000,"payment_status":"paid"}', public.t_req(740));
 PERFORM public.test_assert(a = b,'a repeated request returns the first result');
 PERFORM public.test_assert((SELECT quantity FROM public.raw_materials WHERE id=9102)=v_q-1,'a repeated request deducts stock once');
 PERFORM public.test_assert((SELECT count(*) FROM public.sales)=v_sales,'a repeated request adds no sales lines');
 BEGIN
  PERFORM public.maya_ledger('custom_job',
   '{"description":"Different content","customer_name":"Eta","materials":[{"raw_id":9102,"raw_units":1,"unit_price":5000}],"labour_amount":2000,"payment_status":"paid"}', public.t_req(740));
  RAISE EXCEPTION 'TEST_DID_NOT_FAIL';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'TEST_DID_NOT_FAIL' THEN RAISE; END IF;
  PERFORM public.test_assert(SQLERRM LIKE 'A request key cannot be reused%','a request key cannot be reused for a different job: '||SQLERRM);
 END;
END;
$$;

-- ---- 10. the stock trail shows the job and still adds up ----
DO $$
DECLARE v_last numeric; v_qty numeric; v_type text; v_notes text;
BEGIN
 SELECT movement_type, notes INTO v_type, v_notes FROM public.maya_stock_trail(500)
  WHERE item_type='raw' AND item_id=9101 AND notes LIKE 'Custom job #%for Alpha:%';
 PERFORM public.test_assert(v_type='used_in_job','the trail lists the movement as used_in_job');
 PERFORM public.test_assert(v_notes LIKE '%(Ribbed plate (half sheet))','the trail carries the explanation');
 FOR v_qty, v_last IN
   SELECT (SELECT quantity FROM public.raw_materials r WHERE r.id=t.item_id),
          (SELECT balance_after FROM public.maya_stock_trail(500) x WHERE x.item_type='raw' AND x.item_id=t.item_id ORDER BY x.created_at DESC, x.id DESC LIMIT 1)
   FROM (SELECT DISTINCT item_id FROM public.maya_stock_trail(500) WHERE item_type='raw' AND item_id IN (9101,9102,9103)) t
 LOOP
   PERFORM public.test_assert(v_qty=v_last,'after jobs, stock equals the trail balance ('||v_qty||' vs '||v_last||')');
 END LOOP;
END;
$$;

-- ---- 11. a later payment settles the job's lines like any other credit ----
DO $$
DECLARE mat public.sales%ROWTYPE; lab public.sales%ROWTYPE; v_events bigint;
BEGIN
 -- Beta owes 10,000 (kibaati) + 5,000 (labour). Pay 12,000.
 PERFORM public.maya_ledger('payment','{"customer_name":"Beta","amount":12000}', public.t_req(750));
 SELECT * INTO mat FROM public.sales WHERE customer_name='Beta' AND item_type='raw';
 SELECT * INTO lab FROM public.sales WHERE customer_name='Beta' AND item_type='service';
 PERFORM public.test_assert(mat.amount_paid=10000,'repayment settles the metal line first (oldest line)');
 PERFORM public.test_assert(lab.amount_paid=2000,'and the rest goes to the labour line');
 SELECT count(*) INTO v_events FROM public.debt_events WHERE customer_name='Beta' AND event_type='payment';
 PERFORM public.test_assert(v_events=2,'one repayment event per line it settled');
END;
$$;

-- ---- 12. a deactivated user cannot record jobs; anonymous callers cannot reach the function ----
-- (that user cannot even read the tables, so the "before" numbers are taken as the table owner)
RESET ROLE;
SELECT set_config('t.sales_before', (SELECT count(*) FROM public.sales)::text, false),
       set_config('t.stock_before', (SELECT quantity FROM public.raw_materials WHERE id=9102)::text, false);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
DO $$
BEGIN
 PERFORM public.t_expect_fail('{"description":"Should be refused","customer_name":"Theta","materials":[{"raw_id":9102,"raw_units":1,"unit_price":5000}],"payment_status":"paid"}', 760, '%');
 PERFORM public.test_assert(NOT has_function_privilege('anon','public.maya_ledger(text,jsonb,uuid)','EXECUTE'),'anon cannot run maya_ledger');
END;
$$;
RESET ROLE;
DO $$
BEGIN
 PERFORM public.test_assert((SELECT count(*) FROM public.sales)=current_setting('t.sales_before')::bigint,'a deactivated user leaves no sales lines');
 PERFORM public.test_assert((SELECT quantity FROM public.raw_materials WHERE id=9102)=current_setting('t.stock_before')::numeric,'a deactivated user leaves stock alone');
END;
$$;

-- ---- 13. the migration can be run again, and jobs still work afterwards ----
RESET ROLE;
\i supabase/migrations/20261107_maya_custom_job.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
DO $$
DECLARE r jsonb;
BEGIN
 r := public.maya_ledger('custom_job',
  '{"description":"After re-run","customer_name":"Iota","materials":[{"raw_id":9102,"raw_units":1,"unit_price":5000}],"labour_amount":1000,"payment_status":"paid"}', public.t_req(770));
 PERFORM public.test_assert((r->>'total')::numeric=6000,'jobs still work after the migration is run twice');
END;
$$;

RESET ROLE;
DROP FUNCTION public.t_expect_fail(jsonb, integer, text);
DROP FUNCTION public.t_req(integer);
SELECT 'MAYA CUSTOM JOB TESTS PASSED' AS result;
