# 31 October operating-start update — Maya 0.2.0

The current change adds period financial reporting and changes the cash archive start to Saturday, 31 October 2026. See [reporting details and validation](MAYA_PERIOD_REPORT.md). Earlier October 12 plans below are historical and superseded for the operating date.

Readiness observation on 29 October: the scheduled encrypted database backup run was skipped. The workflow is gated by `MAYA_BACKUPS_ENABLED`; a functioning keep-alive is not proof of a database backup. Verify and enable the existing backup setup before relying on unattended recovery. This update does not change backup credentials or erase database records.

---

# Maya Steel Works — Latest Production Status Addendum

**Date:** 26 Sep 2026  
**Repository:** `lumuxav/maya-steel-works`  
**Production branch:** `main`  
**Production Vercel project:** `maya-steel-works-eboa`

This addendum records production changes completed after the original system handover. It should be read together with `MAYA_SYSTEM_HANDOVER.md`.

---

## 1. Production database reset completed

The test operational data used during development was cleared before live production use.

Preserved:

- Supabase `auth.users`
- Maya `public.users`
- user/profile photo storage

Cleared test operational data included deliveries, raw materials, finished goods, production history, sales, stock movements, stocktakes, debt events, expenses, banking, customer-material jobs, production recipes/standards, corrections and legacy branch-transfer records.

The destructive reset SQL is stored at:

`/scripts/reset-test-business-data.sql`

Do not run it again unless a deliberate full operational reset is required.

---

## 2. Supabase keepalive and availability monitoring

Maya now has a protected database-backed endpoint:

`/api/health/supabase`

The endpoint performs a tiny real query against Supabase and exposes no business data.

Required secret pairing:

- Vercel: `HEALTHCHECK_SECRET`
- GitHub Actions: `MAYA_HEALTHCHECK_SECRET`

Workflow:

`.github/workflows/keep-supabase-active.yml`

The workflow runs every 6 hours and has been manually tested successfully.

UptimeRobot is also configured separately to monitor the production website every 5 minutes. UptimeRobot is an availability monitor; the GitHub health workflow is the database-backed keepalive/check.

---

## 3. Supabase production security hardening

Privileged stock operations were reviewed before production use.

Completed hardening includes:

- anonymous/public execution removed from privileged stock-changing RPCs
- signed-in stock operations validate active Maya users/roles/branch rules
- obsolete multi-branch `transfer_stock` access disabled for normal authenticated use
- privileged implementations moved behind safer private/wrapper logic where required
- exposed SECURITY DEFINER/view warnings reduced/removed through safer design
- foreign-key and history indexes added for transaction tables
- high-traffic RLS policy evaluation optimized without intentionally widening access

Leaked-password protection should remain enabled/reviewed in Supabase Authentication settings as part of the production security checklist.

---

## 4. Performance optimization

To reduce the previous 3–4 second navigation feeling, the application was optimized in several areas:

- shared in-memory signed-in profile/session cache
- short-lived Maya Branch lookup caching
- Home/dashboard independent queries loaded in parallel
- Inventory raw + finished stock loaded in parallel
- Sales stock/recipe lookups loaded in parallel
- missing database indexes added
- selected transaction RLS checks optimized

The correct long-term target is for normal navigation to feel close to immediate on a reasonable connection, while large reports/history screens may take longer.

---

## 5. Persistent login behavior

Supabase session handling was changed so active users are not asked to log in repeatedly.

Current expected behavior:

- session persists across normal app closes/reopens
- tokens auto-refresh
- valid returning sessions bypass the login form
- temporary network/profile-check failures do not destroy the saved session
- explicit Sign out still ends the session
- confirmed inactive/deleted users are forced out
- active sessions continue to re-check account status so deactivated users do not retain indefinite access

This gives staff convenience without weakening account deactivation controls.

---

## 6. Vercel deployment cleanup

A duplicate Vercel project/integration named `maya-steel-works` was also reacting to repository pushes and contributed to Hobby build-rate-limit failures.

The duplicate was disconnected.

The production repository should now deploy only through:

`maya-steel-works-eboa`

Production URL:

`https://maya-steel-works-mgt.vercel.app`

After cleanup, a fresh `main` deployment succeeded and included the previously queued performance/session changes.

---

## 7. Android native Back-button navigation

The first Android shell allowed the phone's system Back action to close Maya from any screen.

The native Capacitor `App` plugin has now been added.

Expected behavior in the current Android release:

- on Stock/Sales/Cash/Settings/other sub-pages, Back navigates through Maya history
- if there is no meaningful prior Maya page, Back returns to Home
- Home is the screen from which Android Back may exit the application

This behavior requires the current native APK because the old installed shell did not contain the App plugin.

The same App plugin is included in the iOS validation build for future native iPhone/iPad navigation support.

---

## 8. Official Android distribution location

The updated APK is now published as the repository's **Latest Release**, not merely left as an Actions artifact.

Release tag:

`maya-latest`

Release name:

`Maya Steel Works — Latest Android`

Direct APK:

`https://github.com/lumuxav/maya-steel-works/releases/download/maya-latest/Maya-Steel-Works.apk`

Normal staff installation should use Releases / the direct URL above rather than historical workflow artifacts.

The current APK remains debug-signed for internal/direct installation. A stable production signing keystore is the next important Android distribution improvement so future upgrades can be installed reliably over existing versions.

---

## 9. Current platform status

| Platform | Current status |
| --- | --- |
| Web | Production on Vercel |
| Android | Latest Release APK available; native Back handling included |
| PWA | Available from supported browsers |
| iPhone/iPad | Unsigned native simulator validation passes; signing/distribution pending |
| Desktop | Responsive production web app |
| Windows native `.exe` | Not packaged |
| macOS native `.dmg` | Not packaged |

---

## 10. Instructions for future development sessions

Before changing production behavior:

1. Read `docs/MAYA_SYSTEM_HANDOVER.md`.
2. Read this addendum.
3. Read `docs/PRODUCTION_CUTOVER.md`.
4. Inspect the current `main` branch rather than assuming commit IDs in documentation are still latest.
5. Preserve the Maya-Branch-only business rules and the Admin/Super Admin distinction.
6. Avoid exposing Supabase server secrets.
7. Avoid creating multiple Vercel integrations for the same production repo.
8. For Android native-shell changes, update/build the APK and ensure the `maya-latest` Release is refreshed.
9. For ordinary web/business changes, deploy through Vercel; a new APK is normally unnecessary.
