# Maya period reporting — version 0.2.0

Maya management can open **Home → Period Report**, **Cash Book → Period Report**, or the management navigation. The existing `/profit` address now opens this report.

1. Select **From** and **To**, or choose Today, Last 7 days, This month, Last month, or Since opening.
2. Select **View report**. Both endpoints include the whole Uganda calendar day.
3. Inspect the totals, reconciliation, daily rows, expense categories and top items/services.
4. Select **Export CSV**. Browsers download a complete CSV; the updated Android APK opens the native share/save sheet. Older APKs without the export plugins need the updated installer or browser for file export.

A range such as 24 June–22 August works across months and years. The current operating history starts Saturday, **31 October 2026**. Earlier records are retained and excluded from the operating report and cash archive. Before opening there are no invented archive days. Future requested end dates show actual activity only through today, which is marked as still in progress.

## Meaning of each total

| Figure | Calculation |
| --- | --- |
| Gross sales | Stock sale invoices plus customer-material service invoices created in the period |
| Credit adjustments | Dated return/compensation events in the period against operating invoices |
| Net sales | Gross sales minus those dated adjustments |
| Cash received | Initial cash at sale, payments received in the period, and unallocated advances |
| Debt repayments | Dated payment events linked to invoices, including earlier-period invoices |
| Advances | Cash received without an invoice allocation; not added to sales |
| Outstanding credit | Outstanding at the period end for invoices created in that period; later payments/adjustments are excluded |
| Net cash before banking | Cash received minus recorded expenses; this is not profit |
| Opening cash | Cumulative operating cash before the requested start, less expenses and confirmed bankings |
| Closing cash | Opening + cash received − expenses − confirmed bankings |
| Pending banking | Shown separately; not deducted until confirmed |
| Estimated profit | Net sales minus estimated material/production cost and recorded expenses |

Financial values are UGX. The report uses `Africa/Kampala`, including fractional seconds on the end date. Zero-activity operating days are included, and CSV exports contain all days even when only the first 31 are displayed.

Banking confirmation status and corrected expenses reflect the current stored record. This is a current reconstruction, not an immutable historical closing statement. Costs are estimated from current recorded batch and production data; there are no frozen sale-time cost snapshots. Missing costs produce **Unavailable**, not false zero costs. Service operating costs must be entered as expenses. Existing return events reduce credit but do not restore inventory, so this report does not invent stock-cost reversals. Undated legacy invoice adjustments make historical outstanding unavailable until reconciled. Cash deficits remain negative and are flagged.

## Access and completeness

The report endpoint authenticates the caller and requires an active Maya admin or super admin. It uses that caller's Supabase permissions; it does not use a service-role key. The response is private and not cached. Branch records are isolated to Maya.

All source pages are fetched in deterministic ID order with exact counts. Pagination continues through server caps smaller than the requested page size. Core query errors, changed counts, duplicate rows and incomplete results do not become zero-valued reports. Row counts and the correction audit are checked before and after loading to detect concurrent changes. This is not a database transaction snapshot; refresh after staff complete concurrent work when reconciling a close.

The database is not reset and no schema migration is required. Historical database migration files retain their original dates; the October 31 change defines the visible operating history, not a new database-wide ban on pre-opening transactions.

## Validation and release

- Financial, calendar, access-control, export and pagination regression tests: `npm run test:logic`.
- Build with isolated placeholder Supabase settings: `npm run build`.
- Browser → Next API → synthetic Supabase HTTP fixture → report/CSV checks at 390px and 1440px: `npm run test:browser`. Install Chromium using `npx playwright install --with-deps chromium` first. `MAYA_TEST_CHROMIUM` may point to a local installed Chromium.
- Tests use synthetic records and do not write to the live database.
- GitHub CI also runs the existing isolated PostgreSQL/RLS transaction tests and encrypted restore exercise.
- The Android workflow tests calculations before packaging, sets a new version code, and publishes an APK with SHA-256 checksums. The existing debug-signing limitation remains documented in `DOWNLOADS.md`.
- Web/PWA updates cover desktop and iPhone. This repository does not distribute Windows/macOS native installers or a signed iOS IPA.

## Readiness item found during this update

The 29 October scheduled encrypted-backup run was skipped. The existing workflow requires the repository variable `MAYA_BACKUPS_ENABLED=true`; it is not evidence of a successful backup merely because the keep-alive runs succeed. Verify the Maya backup connection, encryption recipient, a successful artifact, and restore access before relying on unattended recovery. This release does not change backup secrets or claim that skipped runs are successful.
