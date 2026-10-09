# Maya Steel Works — Pre-launch QA audit

**Business launch day:** Monday, 12 October 2026 (Africa/Kampala)  
**Repository and branch:** lumuxav/maya-steel-works; changes in PR #5  
**Isolation:** Maya only; Universal MGT has not been modified  
**Audit method:** code-path inspection; read-only Maya Supabase schema and policy queries; automated Node tests; Next production build. No live financial transactions were created.

## Verified automated results

- 58 passing Node tests for October 12 launch, Kampala day boundaries, cash-book carry-forward, credit, repayments, service income and banking.
- Focused ESLint passes for the new business-rule module and tests.
- Next.js optimized production build passes with inert CI environment placeholders and **does not use live Supabase credentials**.
- Maya Supabase showed 4 user profiles, 0 sales, 0 expenses, 0 debt events, 0 stock movements and 0 customer-material records at audit time.
- Main business tables have RLS enabled; **enabled RLS does not automatically mean the existing policies are sufficiently restrictive**.
- The Cash Book now fetches independent records concurrently and avoids heavy queries on the pre-launch screen. Client-side forms now reject negative/zero sales, production counts, stocktake counts, expenses and bankings; database-level checks are still required.
- Customer-owned-material services no longer require an unrelated Maya stock item to exist: a service sale uses `item_type='service'` and the non-inventory sentinel `item_id=0`, permitted by the current sales table schema (no stock-item foreign key). The service payload has 17 focused tests.
- Cash opening balances deduct confirmed banking, not unconfirmed/pending banking.
- The official date is stored in `lib/mayaBusiness.mjs`; test `npm run test:logic`.

## Open launch blockers — NOT production-approved

**P0 – Atomicity / partial writes:** Sales record a sale then separately deduct stock. For employees, compensating delete may be forbidden by policy if stock deduction fails. Production can insert a production log before deduct/add stock; a failure can leave inconsistent history. Debt payments, returns and compensation update sales before separately inserting debt events. None is a single database transaction. All these writes must be combined into verified PostgreSQL transactional functions with role checks and locking before a real money/stock launch.

**P0 – RLS write authorization:** Read-only database inspection found `sales_update_auth` grants UPDATE on sales for any authenticated user, and insert policies for sales, bankings, debt events and expenses generally require authentication without verifying active Maya membership, row ownership, amount validity or role. Broad table-write policies can permit direct API tampering even if UI controls are restrictive. Tighten policies and require active Maya identity, appropriate roles, and server-side write paths after a staged integration test.

**P1 – Financial input validations:** Some forms use `if (!amount)` instead of requiring positive and finite values. Test negative, zero, overpayment, decimal, duplicate and simultaneous-submit cases at the server/RPC layer, not just the interface.

**P1 – Long-term archives:** Cash and sales report queries cap source history at 1,000 rows and dashboard at smaller limits, so once Maya grows these pages can silently omit past transactions and show incomplete financial totals. Add paginated queries or date-bucketed server-side aggregates for full-history accounting.

**P1 – Security advisor:** Supabase reports leaked-password protection disabled. Review the provider configuration: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

**P1 – Off-site backups:** Free Supabase projects do not provide downloadable automatic backups. Configure recurring secure offline exports before real operations.

**P1 – Live role/device testing:** Confirm actual Employee/Admin/Super Admin view/permission boundaries, deactivated sessions, Android Back button on a freshly built APK, desktop and iOS responsiveness, and real network errors on a separate nonproduction dataset.

**P1 – Hosting plan:** Vercel Hobby is restricted to personal/noncommercial use. Check that Maya's real-business operation uses a plan permitted by Vercel's terms. A free `vercel.app` domain is not itself an HTTP/TLS security flaw.

## Safe integration test plan (on isolated staging database, not production)

1. Confirm test users with all three roles and a revoked account. Keep test credentials out of source and GitHub logs.
2. Stock: receive a multi-item delivery, verify quantity and supplier, attempt zero/negative/overdrawn delivery; stocktake matching and differing quantities; validate correction and history.
3. Production: process standard raw-to-finished conversion; reject more raw stock than available; inject failure between log/deduction/increase; ensure **all** changes roll back together.
4. Sales: full payment, partial, credit and make-and-sell, including concurrent requests for the last available unit; ensure exactly one sale, stock movement and stock deduction per successful order.
5. Customer-owned material: record forming/cutting/ribbing service with own charge per plate; verify service revenue and that Maya's raw/finished stock is unchanged.
6. Debts: partial customer payment, multiple invoices FIFO, repayment then new day, returns/compensations, overpayment and a deliberately failed debt-event insert; totals and event history must remain consistent.
7. Cashbook: launch day, next-day carried-forward cash, confirmed vs pending bankings, positive expense, rejection of negative expense, oversize banking warnings, and employee versus owner visibility.
8. Access control: attempt cross-role reads/writes directly through the Supabase API; disable user while app is open; verify old credentials and old tokens cannot write business data.
9. Archive: test with >1,000 rows in staging and verify that all reports and opening balances still include full history.
10. Mobile/web: side navigation and system Back, double-press Home exit, screen rotation, keyboard, slow network, offline recovery, theme persistence and data refresh after writes.

## Release gate

A successful CI build and 58 unit tests **do not certify the entire app**. The application should not be represented as fully production-ready until the P0 issues are repaired and key end-to-end cases pass in isolated staging. Do not test destructive workflows against Maya's live operational database.

## Keeping the domain later

Continue with the same Vercel project and same Maya Supabase project. Add the purchased domain in Vercel, update DNS and Supabase redirects, update Capacitor's server URL and rebuild the mobile app. This changes addressing, not database identity.
