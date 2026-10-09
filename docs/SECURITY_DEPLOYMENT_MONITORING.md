# Maya Steel Works — Security, Deployment and Uptime Monitoring

**Updated:** 9 October 2026 | **Scope:** Maya Steel Works only  
**Production:** https://maya-steel-works-mgt.vercel.app  
**Primary branch:** `main` | **Vercel project:** `maya-steel-works-eboa`  
**Supabase project:** existing Maya-specific project; NEVER reuse Universal MGT configuration.

## 1. What is monitoring Maya today?

| Layer | Implementation | What a successful check proves | What it does NOT prove |
| --- | --- | --- | --- |
| GitHub scheduled keep-alive | `.github/workflows/keep-supabase-active.yml`, cron `17 */6 * * *` (UTC) | Authorized HTTP call returned a fresh success response backed by a small live Supabase `users` SELECT | It does not guarantee the project's Free plan will never pause or the action will run forever |
| Health endpoint | `GET /api/health/supabase` | Live service-role database connection and read query work, conditional on correct credentials | Does not test every table/transaction or staff authorization |
| UptimeRobot website monitor | Previously configured externally to check Maya production website every 5 minutes | Production website responds as configured | Does **not** prove Supabase queries succeed unless its check targets a correctly authenticated database-backed endpoint |
| CI tests | `.github/workflows/maya-prelaunch-validation.yml` | App builds, isolated SQL tests, financial logic tests and smoke checks pass | Does not test live customer credentials or verify all real phone behavior |
| Android build | `.github/workflows/build-android-apk.yml` | APK compiles, artifact/releases are available | Does not guarantee old APKs upgrade in place or every physical device works |

The live Maya Supabase project was queried read-only on **9 October 2026** and responded successfully. **This is not evidence of uninterrupted availability for the preceding or coming seven days.** GitHub workflow content was verified, but recent scheduled-run status and GitHub/Vercel secret equality could not be independently inspected using the currently authorized connectors. UptimeRobot's actual monitor dashboard is likewise not directly accessible through these connected tools.

### 1.1 Health endpoint

`/api/health/supabase` uses `force-dynamic`, `revalidate=0` and `Cache-Control: no-store`. It requires the `Authorization: Bearer <secret>` header. Requests without the secret return 401; missing server configuration returns 503.

Upon authorization the server uses **server-side only** `SUPABASE_SERVICE_ROLE_KEY` for:

```js
supabase.from('users').select('id').limit(1)
```

No personally identifying fields or passwords are returned. Successful output resembles:

```json
{
  "ok": true,
  "database": "reachable",
  "service": "maya-steel-works",
  "checked_at": "2026-10-09T20:00:00.000Z"
}
```

This is an illustrative response format, **not a stored real execution record**. Do not expose the bearer secret in URLs or screenshots.

### 1.2 GitHub Actions schedule

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: '17 */6 * * *'
```

The intended runs are **00:17, 06:17, 12:17 and 18:17 UTC** (03:17, 09:17, 15:17 and 21:17 Uganda). This is four real database-backed health calls each day even if nobody signs into Maya.

The workflow checks that its secret exists, invokes the endpoint with retry/timeout controls, and rejects an unfresh or malformed response. It only shows a sanitized result and writes a GitHub step summary.

**Limits:** GitHub schedule runs may be delayed/missed during load or if a workflow is disabled. Verify job history; never interpret a committed YAML file as proof of recent successful execution. GitHub docs: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows

**Supabase Free-project limitation:** Supabase evaluates sufficient real user database activity during the previous seven days; even an active-looking Free project may pause if activity is too low. Four database checks a day are useful, but **not an SLA**. Official policy: https://supabase.com/docs/guides/platform/free-project-pausing

### 1.3 How to verify the protection RIGHT NOW

1. Open [Maya Keep Supabase Active workflow](https://github.com/lumuxav/maya-steel-works/actions/workflows/keep-supabase-active.yml) while logged into the authorized GitHub account.
2. Ensure the workflow is **enabled** (if the menu offers *Enable workflow*, enable it).
3. Open recent **Scheduled** runs, not only PR/build runs; inspect the last successful timestamp and check there has been no gap exceeding 24 hours.
4. Click **Run workflow** on `main` for an immediate manual check. It should produce a green result and a step summary confirming a fresh database query.
5. If it fails with missing `MAYA_HEALTHCHECK_SECRET`, review Repository → Settings → Secrets and variables → Actions; the secret must be configured.
6. In Vercel project `maya-steel-works-eboa` → Settings → Environment Variables, confirm `HEALTHCHECK_SECRET`, `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist in the **Production** environment. GitHub's `MAYA_HEALTHCHECK_SECRET` must have **exactly the same value** as Vercel's `HEALTHCHECK_SECRET` (never show it in logs or chat). Redeploy after changing production environment values.
7. On UptimeRobot, verify the saved Maya monitor points at `https://maya-steel-works-mgt.vercel.app`, is enabled, has a suitable check interval and has an alert contact configured. Examine real uptime history and test the alert contact if available.
8. For more assurance that the database is live, **the GitHub health action itself** is the database test; a website-only UptimeRobot green status is insufficient.
9. Review Supabase dashboard project state and emails for inactivity warnings. If paused, follow provider instructions to resume; do not create a replacement database.

**Verification evidence to retain:** date/UTC time of successful health job, commit/branch, HTTP success, UptimeRobot dashboard snapshot, Supabase project state and who verified it. Never save tokens/passwords.

### 1.4 What happens after seven days without staff login?

- Provided the health workflow **actually executes and succeeds**, it generates user-independent database activity even if staff do not log in to Supabase.
- If the workflow is disabled, its secret expires/is changed, its Vercel URL breaks or the server/database is unavailable, those checks fail and the benefit is lost.
- Supabase alone decides whether activity is sufficient to prevent Free-tier auto-pausing. The only provider-stated guarantee against inactivity pausing is an eligible paid plan. **Do not spend money without approval.**
- Website monitoring is a second availability signal, not a substitute for valid database traffic.

## 2. Access controls and authentication

- Staff log in with their own Supabase Auth identity linked to `public.users`.
- Maya roles: `employee`, `admin` and `super_admin`. Disabled users lose authorized operations.
- Server-side admin APIs independently verify active Super Admin access before using the server-only service key.
- PostgreSQL row-level security and active-Maya membership policies are enforced for operational tables; critical stock/ledger writes use audited RPCs, not direct arbitrary table updates.
- `public.maya_ledger` supports approved atomic business operations. `public.maya_correct_record` authorizes management changes, logs old/new values and uses row locks.
- A `SECURITY DEFINER` endpoint callable by authenticated users must **always** enforce its own role and input checks. Supabase's linter may report these exposed functions as review warnings, even if execution is intentional.
- Direct stock/sales/expense/banking edits and correction-log forgery are restricted by privileges. Keep this enforcement intact during future feature development.
- New/restored/reset passwords are validated for length/complexity; this is **not** equal to provider-side leaked-password screening. Free plan may not have the provider's compromised-password check.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` or `HEALTHCHECK_SECRET` in frontend bundles, `NEXT_PUBLIC_` variables, screenshots, Git logs or markdown.
- Rotate any leaked secret promptly in both Vercel and GitHub, then verify a scheduled health run.

## 3. Deployment workflow

### Web / business logic

```text
Maya-only feature branch
   → Pull request and code review
   → GitHub financial / SQL / build / smoke tests
   → Merge to Maya main
   → Vercel production deployment (maya-steel-works-eboa)
   → Verify actual production page and sign-in
```

Never deploy Universal MGT to Maya's Vercel project. A successful deployment status is not a substitute for transaction acceptance testing.

### Android

```text
Maya main native change
   → build-android-apk.yml
   → Capacitor 8 / Android Gradle debug APK
   → GitHub release with tag maya-android-build-<run-number>
   → Newest marked Latest
```

Latest Android: https://github.com/lumuxav/maya-steel-works/releases/latest

Native back handling lives in `android-native/MainActivity.java` and is inserted during the build. The APK uses the production Vercel website; web UI code is delivered through Vercel, while **native changes need a new APK**. Current builds are debug-signed; future seamless updates require a stable, secure signing key (never upload the keystore to a public repo).

### iOS and desktop

The iOS workflow validates an unsigned native simulator build; there is no verified signed, distributed iOS IPA. iOS users can use the website. Desktop access is the responsive browser app; do not claim a native EXE/DMG installer.

### Purchased domain later

Add the custom domain to the **same** Maya Vercel project, update DNS and Supabase Auth allowlists/redirect URLs, then update `capacitor.config.json` and rebuild Android. Update GitHub keepalive endpoint and UptimeRobot's configured target if switching the canonical website. **Do not migrate or reset Supabase data merely because the domain changes.**

## Encrypted database backup workflow

Maya also has an opt-in [encrypted database backup job](../.github/workflows/maya-encrypted-backup.yml). It runs **daily at 22:53 UTC** only after the Super Admin securely configures its GitHub credentials and **`MAYA_BACKUPS_ENABLED=true`**. It can be run manually first. The generated PostgreSQL archive is age-encrypted before the upload, and the GitHub artifact expires after three days. For a year-long backup, the Super Admin must download a copy off GitHub and preserve the offline decryption identity. **The job is not active by default, and database backups do not contain Storage binary objects.** See [Backup and Recovery](BACKUP_AND_RECOVERY.md).

## 4. Operational backup and recovery (zero-cost options)

**Keep-alive does not equal backup.** A healthy Supabase API cannot recover an accidentally deleted table or operator mistake.

- Before trading, use an authorized, secure method to export the Maya PostgreSQL database to a computer or encrypted removable drive. PostgreSQL `pg_dump` via a compatible, authorized connection is one option; check Supabase's current Free-plan connection and IP restrictions.
- Include critical storage objects/profile images separately if business-critical; database export does not automatically include every storage object's binary content.
- Do not place real backups in GitHub source, chat uploads or unencrypted public cloud storage. Store encrypted backups off the web host and maintain more than one copy.
- Back up **daily at minimum** while transactions occur; confirm the dump is readable and periodically rehearse restore in an isolated, nonproduction environment.
- Document the time, who made the backup, where it is safely stored and who can restore it.
- Keep a documented paper/manual sales/stock/cash fallback for outages; when restored, enter each original event once and reconcile, rather than blindly replaying failed transactions.

If production is down:

1. Check Vercel deployment status and the URL; inspect UptimeRobot's status.
2. Check the GitHub **Keep Supabase Active** workflow job and response.
3. Check Supabase project dashboard for pause, quotas and alerts; resume a paused project through the provider dashboard if necessary.
4. Check current Vercel production secret names without exposing secret values; verify GitHub action secret pairing.
5. Use a manual paper ledger during an outage; after recovery reconcile inventory, payments and cash.
6. Do not run `scripts/reset-test-business-data.sql` in production.

## 5. Known operational considerations

- Vercel's Hobby tier has **noncommercial-use restrictions**; verify the actual account plan/terms before using Maya for a commercial business. A `vercel.app` address itself is not a reason to move data.
- Supabase project pausing, backups and quotas are independent of the app being online.
- Daily archive and cash calculations use `Africa/Kampala`; current start is 12 October 2026.
- System account/profile information is sensitive; do not publish staff email addresses or profile images in operational manuals.

## 6. Monitoring ownership checklist

| Frequency | Action | Owner |
| --- | --- | --- |
| Daily | Verify latest green DB health workflow and website monitoring | Super Admin |
| Daily | Confirm backup was created, encrypted and stored separately | Super Admin/authorized operator |
| Start/end of business day | Stock, sales, cash, banking and variance reconciliation | Business Admin |
| Weekly | Inspect failed scheduled checks, inactive staff and alert contacts | Super Admin |
| Monthly | Rehearse offline restore, rotate exposed credentials if necessary, audit costs/limits | Super Admin and owner |
| Every release | Test role boundaries, protected financial writes, login and physical Android navigation | Team acceptance testers |

**Related:** [Architecture](ARCHITECTURE_AND_DATA_MODEL.md) · [Daily operations](DAILY_OPERATIONS_MANUAL.md) · [Testing and recovery](TESTING_RELEASE_AND_RECOVERY.md).
