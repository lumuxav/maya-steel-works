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

After configuring both secrets:

1. Redeploy Vercel so the health endpoint receives `HEALTHCHECK_SECRET`.
2. Open GitHub → Actions → **Keep Supabase Active**.
3. Run the workflow manually once.
4. Confirm the workflow succeeds and returns `"ok":true`.

### Production recommendation

The scheduled health request is a useful Free Plan safeguard and also provides an availability check. For a business-critical production deployment, the stronger long-term option is a Supabase paid plan because paid projects are not automatically paused for inactivity.

## Production security

Before broad production use, review Supabase Security Advisor findings and resolve externally exposed SECURITY DEFINER objects/functions that are not intentionally public. Also consider leaked-password protection and the rest of Supabase's production security checklist.
