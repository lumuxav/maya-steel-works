# Maya Steel Works — Testing, Release and Recovery Guide

**Updated:** 9 October 2026 | **Goal:** Changes remain testable at zero additional cost and do not damage Maya's live records.

## 1. Project state and scope

- Repository: `lumuxav/maya-steel-works`; production Git branch `main`.
- Web: `https://maya-steel-works-mgt.vercel.app`.
- Android: GitHub Releases latest versioned build.
- Supabase: dedicated Maya Auth/PostgreSQL project, separate from Universal MGT.
- Business archive begins `2026-10-12`, Uganda time.
- Previously confirmed: four Maya staff profiles and zero operational sales/stock/production/cash rows before opening. **Counts change after staff begin operating.**
- Operational workflow testing performed in isolated PostgreSQL must never be mistaken for full end-to-end production device certification.

## 2. Automated verification

Run local logic checks:

```bash
npm ci
npm run test:logic
npx eslint lib/mayaBusiness.mjs lib/mayaPasswordPolicy.mjs tests/*.test.mjs
npm run build
```

CI workflow `.github/workflows/maya-prelaunch-validation.yml` runs on PRs/main:

1. `npm ci` using Node.js 22.
2. Node business, calendar, customer-service and password tests.
3. Focused lint of pure financial/security helpers.
4. Production Next.js build with **nonworking placeholder** Supabase values (never production service keys).
5. HTTP smoke tests on a local Next.js server (important routes return HTML; anonymous API requests denied).
6. An isolated PostgreSQL 16 instance already installed on GitHub's Ubuntu runner, initialized with **synthetic staff/materials** and the schema/migrations (no Docker image pull).
7. SQL rollback, idempotency, stock, debt, role, correction and banking-confirmation security tests.

The most recent previously observed run passed 67 unit tests, 20 HTTP smoke checks and the isolated database suite. These numbers describe a **prior run** and must be rechecked in GitHub for later commits. Check current statuses: https://github.com/lumuxav/maya-steel-works/actions/workflows/maya-prelaunch-validation.yml

### Test fixtures

`tests/postgres/maya_fixture.sql` and `tests/postgres/maya_premigration_policies.sql` create fake staff, sales/stock fixtures, policies and data. The test database runs in the GitHub-hosted runner's local PostgreSQL 16 service; it is not the Maya production Supabase project. The job deliberately avoids external Docker Hub pulls and their rate limits.

**Never** change the CI workflow to point destructive test SQL at the production Supabase URL. Never store or print production access tokens in CI logs.

## 3. Minimum feature acceptance matrix

Perform this checklist when staff are present. Use real transactions only when the business genuinely intends them. Any test rows must stay in synthetic/local staging.

| Area | Pass criteria | Who verifies |
| --- | --- | --- |
| Login/session | Valid account signs in, remains signed in, logout works | Employee/Admin/Super Admin |
| Disabled user | Disabled user cannot continue business writes | Super Admin |
| Archived user | Cannot log in; same returning person can be restored with new password | Super Admin |
| Role scope | Employee cannot access protected management write paths; Admin business access works | Admin/Super Admin |
| Delivery | Raw item and delivery saved once with correct quantity/transport | Employee/Admin |
| Stocktake | Physical count discrepancy logged, no illicit direct inventory editing | Employee/Admin |
| Production | Raw stock decreases, finished increases, log/yield consistent | Employee/Admin |
| Make & Sell | Exactly one sale, appropriate stock movement and production | Employee/Admin |
| Paid/partial/credit | Money and outstanding balance correct; no negative or double deduction | Employee/Admin |
| Customer material | Charge per plate and payment recorded, Maya stock unaffected | Employee/Admin |
| Debt repayment | Outstanding debt reduces; cash received counted on repayment date | Employee/Admin |
| Expense | Positive expense reduces expected cash and is correctly attributed | Employee/Admin |
| Pending banking | Does not reduce confirmed cash; variance displayed correctly | Admin |
| Confirmed banking | Audit records confirmer/time; cannot rewrite confirmed amount/date | Admin |
| Corrections | Valid fields require reason; failing audit rolls back data change | Admin |
| Records & alerts | Relevant stock, banking, production, debt and correction events visible | Admin |
| Android Back | Previous-page navigation, new header Back arrow, double-Back on Home | Actual Android APK user |
| Responsive UI | Records category tabs legible on narrow phone; desktop sidebar scrolls | Mobile and desktop |
| Data isolation | No Universal MGT, other branches, or cross-branch transfers in Maya workflows | Super Admin |
| Health | Github 6-hour job performs fresh Supabase read and reports success | Super Admin |
| Backup | Secure restore-capable offsite export exists | Super Admin |

## 4. Critical failure and concurrency scenarios

In synthetic PostgreSQL tests, deliberately test:

- Two simultaneous sales against one remaining item (no overselling).
- A sale stock-deduction failure (no orphaned sale).
- A production output/log failure (full transaction rollback).
- A debt event failure (amount-paid update and event must roll back together).
- A correction-log insertion fault (the original financial row must remain unchanged).
- Replay of a submitted request ID (no duplicate sale/payment or correction).
- A different payload using the same request ID (must be rejected).
- Return quantity greater than sold quantity and unauthorized compensation (rejected).
- Disabled staff using an unexpired token and Employee attempting Admin-only operations.
- Attempted direct financial table UPDATE/DELETE, audit forgery and `TRUNCATE` (denied).
- A valid pending banking confirmation (status, confirmer and audit row saved together).
- Invoice/stock history exceeding application UI query limits; compare with a full ledger export.

CI already contains representative checks for many cases; **do not claim unimplemented scenarios are covered just because the overall build passes**.

## 5. Zero-cost testing policy

The user's explicit policy is **zero additional monetary cost**:

- Allowed: code checks, existing GitHub Actions quotas, synthetic local PostgreSQL, free read-only Supabase project inspections.
- Do not create a paid Supabase development branch, add charged Vercel/Supabase resources or buy a third-party QA service without separate approval.
- Do not introduce a new local test transaction into the production Maya project just to exercise logic.
- Use publicly available documentation to evaluate provider limitations and keep the owner informed.

## 6. Release process

1. Create a branch in **Maya's repository**, not in Universal MGT.
2. Understand each relevant page, schema migration, current role restrictions, accounting rules and compatibility.
3. Implement, add regression tests and run CI with no production data writes.
4. Review the migration's exact effects and test on isolated PostgreSQL.
5. If a database migration is essential: take a current backup; apply only reviewed DDL to the dedicated Maya project, and verify schema/privileges without test transactions.
6. Merge matching code after its build and DB compatibility tests pass.
7. Verify Vercel successfully deploys production `main`; check sign-in and a non-destructive screen.
8. If native Android code changes, verify the Gradle job and the published versioned release; install the new APK and physically test navigation.
9. Verify protected GitHub keep-alive was not accidentally disabled and that website-monitoring target still points to the canonical URL.
10. Update relevant docs, changelog/README and owner notification.

**Do not publish experimental APKs as Latest or merge a failing CI run.**

## 7. Recovery: version rollback and business data

### Website problem but database healthy

- Identify the last known-good Vercel deployment/commit.
- Revert the offending Maya commit through a PR or redeploy an explicitly verified prior commit using the authorized Vercel UI.
- Check that DB schema changes remain compatible; reverting frontend alone cannot always reverse an incompatible migration.

### Database or transactional problem

- Stop new business entries; preserve symptoms and transaction references.
- Use backups and production monitoring. Prefer forward repair with a migration and isolated verification; destructive DB rollback without a tested plan may corrupt later real records.
- Reconcile physical stock/cash/receipt evidence before resuming.
- Do not blindly re-submit retries; exact `maya_ledger` request IDs exist to avoid duplicate processing, but manual operational auditing is still essential.
- Under no circumstances run the test reset SQL after live trading has begun.

### APK install conflict / offline

- Android builds are debug-signed. A mismatched signing key may prevent upgrade over the installed version.
- Ask staff to verify data synchronization before uninstalling. Reinstall may clear local session/preferences; Supabase server data remains separate.
- The live website is the fallback if the APK wrapper is broken. A network connection is normally required for real database operations.

### Health monitoring failure

- Check workflow green/red status and error output first.
- Distinguish 401 (wrong/missing bearer secret), 503 (missing config or database query failure), website/network outage and Supabase paused state.
- Fix the actual condition before re-running the health action; do not remove authentication to make the check green.
- UptimeRobot website check alone cannot establish Supabase health.

## 8. Open items for the business owner

- Establish an encrypted, off-host **verified database and storage backup**; ideally create and test before the first real transactions.
- Confirm Vercel hosting plan terms allow the commercial use intended.
- Continue role acceptance testing and retain the tested Android build on a real device.
- Implement a stable Android release-signing identity before large-scale APK distribution.
- For long histories, replace limited-row financial aggregates with full paginated/server-side reporting and verify totals.
- Confirm actual scheduled keep-alive run history and UptimeRobot live monitor status at least weekly.

**Related:** [Operations](DAILY_OPERATIONS_MANUAL.md) · [Architecture](ARCHITECTURE_AND_DATA_MODEL.md) · [Monitoring/security](SECURITY_DEPLOYMENT_MONITORING.md).
