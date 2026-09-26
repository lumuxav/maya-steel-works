# Maya Steel Works — Production Cutover

This document records the transition from test data to live production use.

## Production data reset

On 26 Sep 2026, Maya's test operational data was cleared while preserving user accounts and profiles.

Preserved:

- `auth.users`
- `public.users`
- profile photos / storage objects

Cleared:

- deliveries
- raw materials
- finished goods
- production log
- sales
- branch transfers
- stock movements
- stocktakes
- customer materials
- production recipes / standards
- expenses
- expense categories
- banking
- debt events
- corrections log

The repeatable SQL used for this operation is stored at:

`/scripts/reset-test-business-data.sql`

Do not run that script casually. It is destructive and intended only for a deliberate full operational reset.

## Supabase Free Plan availability

Supabase may pause Free Plan projects that show low user database activity over a 7-day period. A few genuine database requests each day are normally enough to prevent automatic pausing. Paid-plan projects are not subject to inactivity pausing.

Official reference:

https://supabase.com/docs/guides/platform/free-project-pausing

### Maya health check

Maya includes a protected production database health endpoint:

`https://maya-steel-works-mgt.vercel.app/api/health/supabase`

The endpoint performs a small real query against Supabase and returns only generic availability information. It requires a bearer secret and does not expose business data.

Required Vercel environment variable:

`HEALTHCHECK_SECRET`

### Scheduled GitHub monitor

Workflow:

`.github/workflows/keep-supabase-active.yml`

It runs every 6 hours and calls the database-backed health endpoint.

Required GitHub Actions repository secret:

`MAYA_HEALTHCHECK_SECRET`

`MAYA_HEALTHCHECK_SECRET` and Vercel's `HEALTHCHECK_SECRET` must contain the same strong random value.

The workflow has been manually tested successfully.

### UptimeRobot

UptimeRobot is also configured against the production web application on a 5-minute interval.

Its purpose is website availability monitoring. The GitHub scheduled endpoint remains the stronger Supabase-specific check because it performs a real database query.

### Production recommendation

The scheduled health request is a useful Free Plan safeguard and availability check. For a business-critical deployment, the stronger long-term option is a Supabase paid plan because paid projects are not automatically paused for inactivity.

## Production security hardening

Before live data entry, privileged Supabase stock operations were reviewed and hardened.

Completed work includes:

- anonymous/public access removed from privileged stock-changing RPCs
- authenticated stock mutations restricted through active Maya-user/role/branch validation
- legacy multi-branch `transfer_stock` access disabled for normal authenticated use
- privileged implementations moved behind safer private/wrapper logic where required
- key SECURITY DEFINER/view exposure warnings removed or reduced
- missing foreign-key/history indexes added
- selected high-traffic RLS checks optimized without intentionally widening permissions

Continue reviewing Supabase Security Advisor after future schema/RLS changes. Leaked-password protection and other Auth security recommendations should remain enabled/reviewed.

## Session policy for production

Active users should remain signed in on their trusted device during normal use.

The application now:

- persists Supabase sessions
- auto-refreshes tokens
- skips the login screen when an active valid session is already stored
- does not erase a valid session because of a temporary network/profile-check error
- forces logout when the user's account is confirmed inactive/deleted
- retains explicit Sign out in Settings

## Vercel production project

The correct production project is:

`maya-steel-works-eboa`

A duplicate Vercel integration/project named `maya-steel-works` was disconnected after duplicate builds contributed to the Hobby build-rate limit.

Only the correct production project should remain connected to `lumuxav/maya-steel-works`.

## Android production distribution

The maintained Android build is published as the repository's Latest Release:

`https://github.com/lumuxav/maya-steel-works/releases/latest`

Direct APK:

`https://github.com/lumuxav/maya-steel-works/releases/download/maya-latest/Maya-Steel-Works.apk`

The current release includes the native Capacitor App plugin so Android Back navigation remains inside Maya until the user reaches Home.

The APK is still debug-signed for internal/direct installation. Configure a stable release signing keystore before relying on seamless long-term APK upgrades across staff devices.
