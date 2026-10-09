CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA private;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;

CREATE TABLE public.users(
 id uuid PRIMARY KEY, full_name text NOT NULL, role text NOT NULL,
 active boolean DEFAULT true, branch text DEFAULT 'Maya Branch'
);
CREATE TABLE public.raw_materials(
 id bigserial PRIMARY KEY, category text NOT NULL, gauge text,
 size_dimensions text, unit text NOT NULL DEFAULT 'pieces',
 quantity numeric DEFAULT 0, current_branch text DEFAULT 'Maya Branch'
);
CREATE TABLE public.finished_goods(
 id bigserial PRIMARY KEY, name text NOT NULL, gauge text,
 size_dimensions text, unit text NOT NULL, quantity numeric DEFAULT 0,
 selling_price numeric NOT NULL, current_branch text DEFAULT 'Maya Branch'
);
CREATE TABLE public.deliveries (
 id bigserial PRIMARY KEY, supplier_name text NOT NULL,
 received_by uuid REFERENCES public.users(id),
 created_at timestamptz DEFAULT now()
);
CREATE TABLE public.production_recipes(
 id bigserial PRIMARY KEY, raw_category text NOT NULL, raw_gauge text, raw_size text,
 finished_name text NOT NULL, finished_size text, yield_per_raw_unit numeric NOT NULL
);
CREATE TABLE public.production_log(
 id bigserial PRIMARY KEY, finished_good_id bigint REFERENCES public.finished_goods(id),
 boss_expected_yield numeric NOT NULL, actual_yield numeric NOT NULL,
 raw_material_id bigint REFERENCES public.raw_materials(id),
 fraction_of_material_used numeric NOT NULL, raw_units_used numeric,
 scrap_generated numeric DEFAULT 0, employee_name text,
 created_at timestamptz DEFAULT now()
);
CREATE TABLE public.stock_movements(
 id bigserial PRIMARY KEY, item_type text NOT NULL, item_id bigint NOT NULL,
 movement_type text NOT NULL, quantity_change numeric NOT NULL,
 notes text, recorded_by uuid REFERENCES public.users(id),
 created_at timestamptz DEFAULT now()
);
CREATE TABLE public.sales(
 id bigserial PRIMARY KEY, item_type text NOT NULL, item_id bigint NOT NULL,
 quantity numeric NOT NULL, selling_price numeric NOT NULL, total_amount numeric NOT NULL,
 customer_name text, payment_status text DEFAULT 'paid', amount_paid numeric DEFAULT 0,
 sold_by uuid REFERENCES public.users(id), item_label text, adjustments numeric DEFAULT 0,
 unit_price numeric DEFAULT 0, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.debt_events(
 id bigserial PRIMARY KEY, sale_id bigint REFERENCES public.sales(id),
 customer_name text NOT NULL, event_type text NOT NULL, amount numeric NOT NULL,
 item_label text, quantity numeric, received_by uuid REFERENCES public.users(id),
 notes text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.bankings(
 id bigserial PRIMARY KEY, banking_date date NOT NULL DEFAULT CURRENT_DATE,
 amount_banked numeric NOT NULL, recorded_by uuid, status text DEFAULT 'pending'
);
CREATE TABLE public.expenses(
 id bigserial PRIMARY KEY, amount numeric NOT NULL, recorded_by uuid, description text NOT NULL
);

CREATE OR REPLACE FUNCTION public.get_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT role FROM public.users WHERE id=auth.uid() $$;

CREATE OR REPLACE FUNCTION private.require_active_maya_user() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_role text;
BEGIN
 SELECT role INTO v_role FROM public.users
 WHERE id=auth.uid() AND active=true AND coalesce(branch,'Maya Branch')='Maya Branch';
 IF v_role IS NULL THEN RAISE EXCEPTION 'Active Maya Branch account required'; END IF;
 RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION private.deduct_stock_internal(
 p_item_type text,p_item_id bigint,p_quantity numeric,
 p_movement_type text,p_notes text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_qty numeric;
BEGIN
 PERFORM private.require_active_maya_user();
 IF p_quantity IS NULL OR p_quantity<=0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 IF p_item_type='raw' THEN
  SELECT quantity INTO v_qty FROM public.raw_materials
  WHERE id=p_item_id AND coalesce(current_branch,'Maya Branch')='Maya Branch' FOR UPDATE;
  IF v_qty IS NULL OR v_qty<p_quantity THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
  UPDATE public.raw_materials SET quantity=quantity-p_quantity WHERE id=p_item_id;
 ELSIF p_item_type='finished' THEN
  SELECT quantity INTO v_qty FROM public.finished_goods
  WHERE id=p_item_id AND coalesce(current_branch,'Maya Branch')='Maya Branch' FOR UPDATE;
  IF v_qty IS NULL OR v_qty<p_quantity THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
  UPDATE public.finished_goods SET quantity=quantity-p_quantity WHERE id=p_item_id;
 ELSE RAISE EXCEPTION 'Invalid stock type';
 END IF;
 INSERT INTO public.stock_movements(item_type,item_id,movement_type,quantity_change,notes,recorded_by)
 VALUES(p_item_type,p_item_id,p_movement_type,-p_quantity,p_notes,auth.uid());
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION private.add_stock_internal(
 p_item_type text,p_item_id bigint,p_quantity numeric,
 p_movement_type text,p_notes text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 PERFORM private.require_active_maya_user();
 IF p_quantity IS NULL OR p_quantity<=0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 IF p_item_type='finished' THEN
  UPDATE public.finished_goods SET quantity=quantity+p_quantity
    WHERE id=p_item_id AND coalesce(current_branch,'Maya Branch')='Maya Branch';
 ELSE RAISE EXCEPTION 'Invalid stock type';
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stock not found'; END IF;
 INSERT INTO public.stock_movements(item_type,item_id,movement_type,quantity_change,notes,recorded_by)
 VALUES(p_item_type,p_item_id,p_movement_type,p_quantity,p_notes,auth.uid());
 RETURN true;
END;
$$;

GRANT USAGE ON SCHEMA public, auth, private TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

DO $$
DECLARE v record;
BEGIN
 FOR v IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v.tablename);
  EXECUTE format('CREATE POLICY permissive_fixture ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',v.tablename);
 END LOOP;
END;
$$;

INSERT INTO public.users(id,full_name,role,active) VALUES
 ('11111111-1111-1111-1111-111111111111','Test Employee','employee',true),
 ('22222222-2222-2222-2222-222222222222','Test Admin','admin',true),
 ('33333333-3333-3333-3333-333333333333','Disabled Employee','employee',false);
INSERT INTO public.raw_materials(category,gauge,size_dimensions,quantity)
 VALUES ('kibaati','28','8ft',20);
INSERT INTO public.production_recipes(raw_category,raw_gauge,raw_size,finished_name,finished_size,yield_per_raw_unit)
 VALUES ('kibaati','28','8ft','Louvers','8ft',5);
