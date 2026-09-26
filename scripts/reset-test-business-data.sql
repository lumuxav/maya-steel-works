-- Maya Steel Works production cutover reset
-- DESTRUCTIVE: clears business/test data but deliberately preserves:
--   auth.users
--   public.users
--   profile photos / storage objects
--
-- Run only when intentionally resetting Maya operational data.

begin;

truncate table
  public.debt_events,
  public.stock_movements,
  public.stocktakes,
  public.production_log,
  public.branch_transfers,
  public.sales,
  public.bankings,
  public.expenses,
  public.expense_categories,
  public.production_recipes,
  public.customer_materials,
  public.corrections_log,
  public.finished_goods,
  public.raw_materials,
  public.deliveries
restart identity;

commit;
