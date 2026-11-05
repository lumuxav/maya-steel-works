-- Maya raw-stock <-> production-standard matching (single source of truth).
--
-- Problem fixed: the Production / Make & Sell "Maya Branch batch" menu was empty
-- because matching was done in the browser against raw_materials_*_view with
--   * category: exact text equality (ilike without wildcards),
--   * gauge/size: plain substring, and a NULL gauge can never match,
--   * errors from the view/RLS silently ignored.
-- Stock received in "Simple" mode (gauge = NULL) or typed as "Plain plates" when
-- the standard says "plain" therefore never appeared, and staff could not produce.
--
-- New rule (used by BOTH the menu and the production function, so they can never
-- disagree): every filled-in field of the standard (category, gauge, size) must
-- appear as a whole term inside the stock label "category gauge size".
--   "1.2"  matches "Plain 1.2mm 4x8ft"   but not "1.25mm", "11.2" or "0.12"
--   "4x8ft" matches "4 x 8ft" (spaces around x are ignored)
--   "1.2mm" matches "1.2 mm"; inch marks (2.5" or a stray "") are ignored
--   empty gauge/size on the standard = any gauge/size
--
-- Safe to run more than once (CREATE OR REPLACE only; no tables or data are changed).
--
-- Deploy order: run this file in the Supabase SQL editor FIRST, then deploy the app.

CREATE OR REPLACE FUNCTION private.maya_norm(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  -- 1. lower-case, "×" -> "x", drop inch/quote marks (2.5" / 2.5 "" -> 2.5)
  -- 2. collapse spaces
  -- 3. "4x8ft" / "4 x 8ft" / "4×8ft" all become "4 x 8ft" (spaces around x, so a
  --    gauge that follows an x, e.g. "2.5 x 1.5mm", is still its own term)
  -- 4. "1.2 mm" -> "1.2mm", "8 ft" -> "8ft"
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(replace(coalesce(p,''), '×', 'x')), '["''”“″′]', '', 'g'),
          '\s+', ' ', 'g'),
        '(\d)\s*x\s*(?=\d)', '\1 x ', 'g'),
      '(\d)\s+(mm|cm|ft|kg)(?![a-z])', '\1\2', 'g'))
$$;

CREATE OR REPLACE FUNCTION private.maya_has_term(p_haystack text, p_term text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN private.maya_norm(p_term) = '' THEN true
    ELSE (' ' || private.maya_norm(p_haystack) || ' ') ~
         ('(^|[^a-z0-9.])'
          || regexp_replace(private.maya_norm(p_term), '([^[:alnum:] ])', '\\\1', 'g')
          || '(?![0-9]|\.[0-9])')
  END
$$;

CREATE OR REPLACE FUNCTION private.maya_raw_matches(
  p_category text, p_gauge text, p_size text,
  p_rec_category text, p_rec_gauge text, p_rec_size text
) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT private.maya_has_term(concat_ws(' ', p_category, p_gauge, p_size), p_rec_category)
     AND private.maya_has_term(concat_ws(' ', p_category, p_gauge, p_size), p_rec_gauge)
     AND private.maya_has_term(concat_ws(' ', p_category, p_gauge, p_size), p_rec_size)
$$;
REVOKE ALL ON FUNCTION private.maya_norm(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.maya_has_term(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.maya_raw_matches(text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;

-- Production now uses the same rule as the menu. Everything else is unchanged
-- from 20261009_maya_atomic_ledger_and_rls.sql.
CREATE OR REPLACE FUNCTION private.maya_produce(
  p_recipe_id bigint, p_raw_id bigint, p_used numeric, p_made numeric, p_scrap numeric, p_default_price numeric DEFAULT 0
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_recipe public.production_recipes%ROWTYPE;
  v_raw public.raw_materials%ROWTYPE;
  v_fg_id bigint;
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
REVOKE ALL ON FUNCTION private.maya_produce(bigint,bigint,numeric,numeric,numeric,numeric) FROM PUBLIC, anon, authenticated;

-- The menu. Returns only Maya Branch batches with stock that match the standard,
-- oldest first (FIFO). No cost columns, so it is safe for employees, and it does not
-- depend on raw_materials_employee_view / raw_materials_admin_view.
CREATE OR REPLACE FUNCTION public.maya_recipe_batches(p_recipe_id bigint)
RETURNS TABLE(
  id bigint, category text, gauge text, size_dimensions text,
  unit text, quantity numeric, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_active_maya_user();
  RETURN QUERY
  SELECT r.id::bigint, r.category::text, r.gauge::text, r.size_dimensions::text,
         r.unit::text, r.quantity::numeric, r.created_at::timestamptz
  FROM public.raw_materials r
  JOIN public.production_recipes p ON p.id = p_recipe_id
  WHERE coalesce(r.current_branch,'Maya Branch') = 'Maya Branch'
    AND coalesce(r.quantity,0) > 0
    AND private.maya_raw_matches(r.category, r.gauge, r.size_dimensions,
          p.raw_category, p.raw_gauge, p.raw_size)
  ORDER BY r.created_at ASC, r.id ASC;
END;
$$;
REVOKE ALL ON FUNCTION public.maya_recipe_batches(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maya_recipe_batches(bigint) TO authenticated;
