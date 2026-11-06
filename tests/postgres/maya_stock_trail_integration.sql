-- Regression tests for 20261106_maya_stock_trail.sql
-- Runs after maya_fixture.sql + the 20261009 and 20261105 migrations (see CI workflow).
-- Must be started from the repository root (it re-runs the migration with \i to test the back-fill).

RESET ROLE;

-- Stock that was "received" (so the movement history adds up to the quantity) plus a standard.
INSERT INTO public.raw_materials(id,category,gauge,size_dimensions,quantity)
  VALUES (9001,'Plain plates','0.8mm','4 x 8ft',20);
INSERT INTO public.stock_movements(item_type,item_id,movement_type,quantity_change,notes,recorded_by)
  VALUES ('raw',9001,'received',20,'Delivery received','22222222-2222-2222-2222-222222222222');
INSERT INTO public.production_recipes(id,raw_category,raw_gauge,raw_size,finished_name,finished_size,yield_per_raw_unit)
  VALUES (9001,'plain','0.8',NULL,'Louvers','2inch x 8ft',24);
-- another branch + a transfer: neither may appear on the Maya trail
INSERT INTO public.raw_materials(id,category,gauge,quantity,current_branch) VALUES (9002,'Plain','1mm',5,'Other Branch');
INSERT INTO public.stock_movements(item_type,item_id,movement_type,quantity_change,notes)
  VALUES ('raw',9002,'received',5,'other branch stock');
INSERT INTO public.raw_materials(id,category,gauge,quantity) VALUES (9003,'Plain','2mm',0);
INSERT INTO public.stock_movements(item_type,item_id,movement_type,quantity_change,notes) VALUES
  ('raw',9003,'received',5,'Delivery received'),
  ('raw',9003,'transfer_out',-5,'moved to another branch');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);

-- ---- production writes a note that names the run, the sheets used and the goods made ----
DO $$
DECLARE v_result jsonb; v_fg bigint; v_run bigint; v_notes text; v_n numeric;
BEGIN
 v_result := public.maya_ledger('production','{"recipe_id":9001,"raw_id":9001,"raw_units":3,"quantity":72,"scrap":0}',
   '00000000-0000-0000-0000-000000000601');
 v_fg := (v_result->>'finished_good_id')::bigint;
 SELECT max(id) INTO v_run FROM public.production_log WHERE raw_material_id=9001;

 SELECT notes INTO v_notes FROM public.stock_movements
  WHERE item_type='raw' AND item_id=9001 AND movement_type='used_in_production';
 PERFORM public.test_assert(v_notes = format('Production run #%s: used 3 x Plain plates 0.8mm 4 x 8ft -> made 72 x Louvers 0.8 2inch x 8ft', v_run),
   'raw deduction note names run, sheets and goods: '||coalesce(v_notes,'null'));

 SELECT notes INTO v_notes FROM public.stock_movements
  WHERE item_type='finished' AND item_id=v_fg AND movement_type='produced';
 PERFORM public.test_assert(v_notes = format('Production run #%s: made from 3 x Plain plates 0.8mm 4 x 8ft', v_run),
   'finished addition note names run and source: '||coalesce(v_notes,'null'));

 SELECT quantity INTO v_n FROM public.raw_materials WHERE id=9001;
 PERFORM public.test_assert(v_n=17,'raw stock reduced by the sheets used');
 SELECT quantity INTO v_n FROM public.finished_goods WHERE id=v_fg;
 PERFORM public.test_assert(v_n=72,'finished goods increased by the pieces made');

 -- sale of part of the goods: the note names the sale and the customer
 v_result := public.maya_ledger('sale',
   format('{"item_type":"finished","item_id":%s,"quantity":56,"unit_price":1000,"payment_status":"paid","customer_name":"Alpha"}', v_fg)::jsonb,
   '00000000-0000-0000-0000-000000000602');
 SELECT notes INTO v_notes FROM public.stock_movements
  WHERE item_type='finished' AND item_id=v_fg AND movement_type='sold';
 PERFORM public.test_assert(v_notes = format('Sale #%s to Alpha', (v_result->>'id')::bigint),
   'finished sale note names sale and customer: '||coalesce(v_notes,'null'));
 SELECT quantity INTO v_n FROM public.finished_goods WHERE id=v_fg;
 PERFORM public.test_assert(v_n=16,'finished stock reduced by the sale');

 -- blank customer is recorded as Walk-in, on raw stock too
 v_result := public.maya_ledger('sale',
   '{"item_type":"raw","item_id":9001,"quantity":1,"unit_price":500,"payment_status":"paid","customer_name":"  "}',
   '00000000-0000-0000-0000-000000000603');
 SELECT notes INTO v_notes FROM public.stock_movements
  WHERE item_type='raw' AND item_id=9001 AND movement_type='sold';
 PERFORM public.test_assert(v_notes = format('Sale #%s to Walk-in', (v_result->>'id')::bigint),
   'raw sale note names sale and Walk-in: '||coalesce(v_notes,'null'));
END;
$$;

-- ---- a sale that fails the stock check leaves no sale row and no movement behind ----
DO $$
DECLARE v_sales bigint; v_moves bigint; v_fg bigint;
BEGIN
 SELECT id INTO v_fg FROM public.finished_goods WHERE name='Louvers' AND gauge='0.8';
 SELECT count(*) INTO v_sales FROM public.sales;
 SELECT count(*) INTO v_moves FROM public.stock_movements;
 BEGIN
  PERFORM public.maya_ledger('sale',
    format('{"item_type":"finished","item_id":%s,"quantity":999,"unit_price":1000,"payment_status":"paid","customer_name":"Alpha"}', v_fg)::jsonb,
    '00000000-0000-0000-0000-000000000604');
  RAISE EXCEPTION 'Expected insufficient stock';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Expected insufficient stock' THEN RAISE; END IF;
 END;
 PERFORM public.test_assert((SELECT count(*) FROM public.sales)=v_sales,'failed sale left no sales row');
 PERFORM public.test_assert((SELECT count(*) FROM public.stock_movements)=v_moves,'failed sale left no movement');
END;
$$;

-- ---- Make & Sell: the goods are made and sold in one step, both lines are explained ----
DO $$
DECLARE v_result jsonb; v_fg bigint; v_before numeric; v_after numeric; v_made text; v_sold text;
BEGIN
 SELECT id, quantity INTO v_fg, v_before FROM public.finished_goods WHERE name='Louvers' AND gauge='0.8';
 v_result := public.maya_ledger('make_sale',
   '{"recipe_id":9001,"raw_id":9001,"raw_units":1,"quantity":24,"unit_price":1000,"payment_status":"paid","customer_name":"Beta"}',
   '00000000-0000-0000-0000-000000000605');
 SELECT notes INTO v_made FROM public.stock_movements
  WHERE item_type='finished' AND item_id=v_fg AND movement_type='produced' ORDER BY id DESC LIMIT 1;
 SELECT notes INTO v_sold FROM public.stock_movements
  WHERE item_type='finished' AND item_id=v_fg AND movement_type='sold' ORDER BY id DESC LIMIT 1;
 PERFORM public.test_assert(v_made LIKE 'Production run #%: made from 1 x Plain plates 0.8mm 4 x 8ft','make&sell production note: '||v_made);
 PERFORM public.test_assert(v_sold = format('Sale #%s to Beta',(v_result->>'id')::bigint),'make&sell sale note: '||v_sold);
 SELECT quantity INTO v_after FROM public.finished_goods WHERE id=v_fg;
 PERFORM public.test_assert(v_after=v_before,'made-and-sold goods leave finished stock unchanged');
END;
$$;

-- ---- the stock trail: item names, running balance, reconciles to stock, hides other branches ----
DO $$
DECLARE v_fg bigint; v_last numeric; v_qty numeric; v_rows bigint; v_label text; v_who text;
BEGIN
 SELECT id INTO v_fg FROM public.finished_goods WHERE name='Louvers' AND gauge='0.8';

 SELECT balance_after INTO v_last FROM public.maya_stock_trail(500)
  WHERE item_type='finished' AND item_id=v_fg ORDER BY created_at DESC, id DESC LIMIT 1;
 SELECT quantity INTO v_qty FROM public.finished_goods WHERE id=v_fg;
 PERFORM public.test_assert(v_last=v_qty,'finished: newest balance_after equals stock now ('||v_last||' vs '||v_qty||')');

 SELECT balance_after INTO v_last FROM public.maya_stock_trail(500)
  WHERE item_type='raw' AND item_id=9001 ORDER BY created_at DESC, id DESC LIMIT 1;
 SELECT quantity INTO v_qty FROM public.raw_materials WHERE id=9001;
 PERFORM public.test_assert(v_last=v_qty,'raw: newest balance_after equals stock now ('||v_last||' vs '||v_qty||')');

 SELECT item_label, recorded_by_name INTO v_label, v_who FROM public.maya_stock_trail(500)
  WHERE item_type='raw' AND item_id=9001 AND movement_type='received';
 PERFORM public.test_assert(v_label='Plain plates 0.8mm 4 x 8ft','trail carries the item name: '||coalesce(v_label,'null'));
 PERFORM public.test_assert(v_who='Test Admin','trail carries who recorded it: '||coalesce(v_who,'null'));

 SELECT count(*) INTO v_rows FROM public.maya_stock_trail(500) WHERE item_id IN (9002) AND item_type='raw';
 PERFORM public.test_assert(v_rows=0,'other-branch stock is not on the Maya trail');
 SELECT count(*) INTO v_rows FROM public.maya_stock_trail(500) WHERE movement_type LIKE 'transfer%';
 PERFORM public.test_assert(v_rows=0,'transfer movements are not on the Maya trail');
 SELECT count(*) INTO v_rows FROM public.maya_stock_trail(2);
 PERFORM public.test_assert(v_rows=2,'limit is honoured');
END;
$$;

-- a deactivated user gets nothing; anonymous callers cannot run it at all
SELECT set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
DO $$
BEGIN
 BEGIN
  PERFORM * FROM public.maya_stock_trail(10);
  RAISE EXCEPTION 'Expected inactive rejection';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Expected inactive rejection' THEN RAISE; END IF;
 END;
 PERFORM public.test_assert(NOT has_function_privilege('anon','public.maya_stock_trail(integer)','EXECUTE'),'anon cannot run the trail');
END;
$$;

-- ---- back-fill of old generic notes (re-run the migration over legacy rows) ----
RESET ROLE;
INSERT INTO public.raw_materials(id,category,gauge,size_dimensions,quantity) VALUES (9004,'Plain plates','1mm','4 x 8ft',10);
INSERT INTO public.finished_goods(id,name,gauge,size_dimensions,unit,quantity,selling_price)
  VALUES (9004,'Legacy Louvers','1mm','2inch','pieces',7,0);
INSERT INTO public.production_log(finished_good_id,boss_expected_yield,actual_yield,raw_material_id,fraction_of_material_used,raw_units_used,created_at)
  VALUES (9004,10,10,9004,0.1,1,'2026-01-01 08:00:00+00');
INSERT INTO public.stock_movements(item_type,item_id,movement_type,quantity_change,notes,created_at) VALUES
  ('raw',9004,'used_in_production',-1,'Maya production','2026-01-01 08:00:00+00'),
  ('finished',9004,'produced',10,'Maya production','2026-01-01 08:00:00+00');
INSERT INTO public.sales(item_type,item_id,quantity,selling_price,total_amount,customer_name,created_at) VALUES
  ('finished',9004,3,100,300,'Old Customer','2026-01-02 09:00:00+00'),
  ('raw',9004,2,100,200,NULL,'2026-01-03 09:00:00+00');
INSERT INTO public.stock_movements(item_type,item_id,movement_type,quantity_change,notes,created_at) VALUES
  ('finished',9004,'sold',-3,'Maya sale','2026-01-02 09:00:00+00'),
  ('raw',9004,'sold',-2,'Maya sale','2026-01-03 09:00:00+00'),
  ('raw',9004,'sold',-1,'Maya sale','2026-01-04 09:00:00+00');   -- no matching sale row: must stay as is

\i supabase/migrations/20261106_maya_stock_trail.sql
\i supabase/migrations/20261106_maya_stock_trail.sql

DO $$
DECLARE v_run bigint; v_notes text;
BEGIN
 SELECT id INTO v_run FROM public.production_log WHERE finished_good_id=9004;
 SELECT notes INTO v_notes FROM public.stock_movements WHERE item_type='raw' AND item_id=9004 AND movement_type='used_in_production';
 PERFORM public.test_assert(v_notes = format('Production run #%s: used 1 x Plain plates 1mm 4 x 8ft -> made 10 x Legacy Louvers 1mm 2inch', v_run),'back-filled raw note: '||v_notes);
 SELECT notes INTO v_notes FROM public.stock_movements WHERE item_type='finished' AND item_id=9004 AND movement_type='produced';
 PERFORM public.test_assert(v_notes = format('Production run #%s: made from 1 x Plain plates 1mm 4 x 8ft', v_run),'back-filled finished note: '||v_notes);
 SELECT notes INTO v_notes FROM public.stock_movements WHERE item_type='finished' AND item_id=9004 AND movement_type='sold';
 PERFORM public.test_assert(v_notes = format('Sale #%s to Old Customer', (SELECT id FROM public.sales WHERE item_type='finished' AND item_id=9004)),'back-filled sale note: '||v_notes);
 SELECT notes INTO v_notes FROM public.stock_movements WHERE item_type='raw' AND item_id=9004 AND movement_type='sold' AND quantity_change=-2;
 PERFORM public.test_assert(v_notes = format('Sale #%s to Walk-in', (SELECT id FROM public.sales WHERE item_type='raw' AND item_id=9004)),'back-filled blank customer: '||v_notes);
 SELECT notes INTO v_notes FROM public.stock_movements WHERE item_type='raw' AND item_id=9004 AND movement_type='sold' AND quantity_change=-1;
 PERFORM public.test_assert(v_notes='Maya sale','a movement that matches no sale is left alone');
 PERFORM public.test_assert((SELECT quantity FROM public.raw_materials WHERE id=9004)=10,'back-fill did not touch stock quantities');
 PERFORM public.test_assert((SELECT sum(quantity_change) FROM public.stock_movements WHERE item_type='finished' AND item_id=9004)=7,'back-fill did not touch movement quantities');
END;
$$;

SELECT 'MAYA STOCK TRAIL TESTS PASSED' AS result;
