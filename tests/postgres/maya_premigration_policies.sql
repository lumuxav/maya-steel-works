DROP POLICY permissive_fixture ON public.sales;
CREATE POLICY sales_select ON public.sales FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY sales_insert ON public.sales FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY sales_update_auth ON public.sales FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY sales_update ON public.sales FOR UPDATE TO authenticated USING (public.get_user_role() IN ('admin','super_admin'));
DROP POLICY permissive_fixture ON public.debt_events;
CREATE POLICY debt_select ON public.debt_events FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY debt_insert ON public.debt_events FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY debt_update ON public.debt_events FOR UPDATE TO authenticated USING (public.get_user_role() IN ('admin','super_admin'));
DROP POLICY permissive_fixture ON public.bankings;
CREATE POLICY bank_insert ON public.bankings FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY bank_select ON public.bankings FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY permissive_fixture ON public.expenses;
CREATE POLICY exp_insert ON public.expenses FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY exp_select ON public.expenses FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY permissive_fixture ON public.deliveries;
CREATE POLICY del_insert ON public.deliveries FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY del_select ON public.deliveries FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);
