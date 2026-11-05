-- Regression tests for 20261105_maya_raw_stock_matching.sql
-- Runs after maya_fixture.sql + the 20261009 migrations (see CI workflow).

-- ---- pure matcher (runs as superuser; function lives in private schema) ----
DO $$
BEGIN
 -- how real staff type stock vs how the boss types standards
 PERFORM public.test_assert(private.maya_raw_matches('Plain','1.2mm','4x8ft','plain','1.2',NULL),'plain + 1.2 matches Plain 1.2mm');
 PERFORM public.test_assert(private.maya_raw_matches('Plain plates','1.2mm',NULL,'plain','1.2',NULL),'plain matches category "Plain plates"');
 PERFORM public.test_assert(private.maya_raw_matches('PLAIN','1.2 mm',NULL,'plain','1.2',NULL),'case and spaces ignored');
 PERFORM public.test_assert(private.maya_raw_matches('Plain',NULL,NULL,'plain',NULL,NULL),'blank gauge on standard = any gauge');
 PERFORM public.test_assert(private.maya_raw_matches('Plain','1.2mm','4 x 8ft','plain','1.2','4x8ft'),'4 x 8ft equals 4x8ft');
 PERFORM public.test_assert(private.maya_raw_matches('Plain',NULL,'1.2mm 4x8ft','plain','1.2',NULL),'gauge typed into size field still matches');
 -- real names from the Maya stock screen (whole name typed in category, no gauge)
 PERFORM public.test_assert(private.maya_raw_matches('Plain plates 1.5mm 5 x 4ft damage',NULL,NULL,'plain','1.5',NULL),'Simple-mode name with gauge inside matches');
 PERFORM public.test_assert(private.maya_raw_matches('Sliding door channels 1.2 mm 8ft',NULL,NULL,'sliding door channels','1.2mm',NULL),'1.2mm standard matches stock typed "1.2 mm"');
 PERFORM public.test_assert(private.maya_raw_matches('Ebibaati 2.5 x 2mm 8ft',NULL,NULL,'ebibaati','2',NULL),'gauge directly after an x is found (2.5 x 2mm)');
 PERFORM public.test_assert(private.maya_raw_matches('Ebibaati 2.5 "" x 1.5mm 8ft',NULL,NULL,'ebibaati','1.5','2.5"'),'stray quote marks and inch mark ignored');
 PERFORM public.test_assert(NOT private.maya_raw_matches('Ebibaati 2.5 x 2mm 8ft',NULL,NULL,'ebibaati','2.5mm',NULL),'2.5 inch width is not mistaken for a 2.5mm gauge');
 -- must NOT match
 PERFORM public.test_assert(NOT private.maya_raw_matches('Plain','1.25mm',NULL,'plain','1.2',NULL),'1.2 must not match 1.25mm');
 PERFORM public.test_assert(NOT private.maya_raw_matches('Plain','11.2mm',NULL,'plain','1.2',NULL),'1.2 must not match 11.2mm');
 PERFORM public.test_assert(NOT private.maya_raw_matches('Plain','0.12mm',NULL,'plain','1.2',NULL),'1.2 must not match 0.12mm');
 PERFORM public.test_assert(NOT private.maya_raw_matches('Pipe','1.2mm',NULL,'plain','1.2',NULL),'different category rejected');
 PERFORM public.test_assert(NOT private.maya_raw_matches('Plain',NULL,NULL,'plain','1.2',NULL),'stock with no gauge cannot satisfy a gauge standard');
 PERFORM public.test_assert(NOT private.maya_raw_matches('Plain','1.2mm','4x6ft','plain','1.2','4x8ft'),'wrong size rejected');
 -- regex metacharacters in the standard must not break or widen the match
 PERFORM public.test_assert(NOT private.maya_raw_matches('Plain','1.2mm',NULL,'pl(ain','1.2',NULL),'regex chars are escaped');
 PERFORM public.test_assert(NOT private.maya_raw_matches('Plain','1x2mm',NULL,'plain','1.2',NULL),'dot is literal, not wildcard');
END;
$$;

-- ---- menu RPC + production through the same rule, as an employee ----
INSERT INTO public.raw_materials(category,gauge,size_dimensions,quantity,created_at) VALUES
 ('Plain plates','1.2mm','4x8ft',30,'2026-11-01'),   -- id 2  matches
 ('Plain',NULL,NULL,10,'2026-11-02'),                -- id 3  no gauge -> must NOT match 1.2
 ('Plain','1.25mm','4x8ft',10,'2026-11-03'),         -- id 4  must NOT match 1.2
 ('Plain','1.2mm','4x8ft',0,'2026-11-04'),           -- id 5  empty stock hidden
 ('Plain','1.2mm','4x8ft',7,'2026-10-30');           -- id 6  matches, oldest -> first
INSERT INTO public.raw_materials(category,gauge,size_dimensions,quantity,current_branch) VALUES
 ('Plain','1.2mm','4x8ft',50,'Other Branch');        -- id 7  other branch hidden
INSERT INTO public.production_recipes(raw_category,raw_gauge,raw_size,finished_name,finished_size,yield_per_raw_unit)
 VALUES ('plain','1.2',NULL,'Ebibaati','2.5 inch x 8ft',22);   -- recipe id 2

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
DO $$
DECLARE v_ids bigint[]; v_result jsonb; v_n numeric;
BEGIN
 SELECT array_agg(id ORDER BY created_at, id) INTO v_ids FROM public.maya_recipe_batches(2);
 PERFORM public.test_assert(v_ids = ARRAY[6,2]::bigint[],'menu lists only matching in-stock Maya batches, oldest first: '||coalesce(v_ids::text,'null'));

 v_result := public.maya_ledger('production','{"recipe_id":2,"raw_id":2,"raw_units":2,"quantity":44,"scrap":0}',
   '00000000-0000-0000-0000-000000000501');
 SELECT quantity INTO v_n FROM public.raw_materials WHERE id=2;
 PERFORM public.test_assert(v_n=28,'production accepted the batch the menu offered');

 BEGIN
  PERFORM public.maya_ledger('production','{"recipe_id":2,"raw_id":4,"raw_units":1,"quantity":22,"scrap":0}',
    '00000000-0000-0000-0000-000000000502');
  RAISE EXCEPTION 'Expected mismatch';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Expected mismatch' THEN RAISE; END IF;
  PERFORM public.test_assert(SQLERRM='Raw stock does not match the production standard','1.25mm batch rejected: '||SQLERRM);
 END;
END;
$$;

-- a deactivated user gets nothing from the menu
SELECT set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
DO $$
BEGIN
 BEGIN
  PERFORM * FROM public.maya_recipe_batches(2);
  RAISE EXCEPTION 'Expected inactive rejection';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Expected inactive rejection' THEN RAISE; END IF;
 END;
END;
$$;
RESET ROLE;

SELECT 'MAYA RAW MATCHING TESTS PASSED' AS result;
