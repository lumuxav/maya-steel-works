import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workflow = readFileSync('.github/workflows/keep-supabase-active.yml', 'utf8')
const endpoint = readFileSync('app/api/health/supabase/route.js', 'utf8')

test('Maya Supabase health workflow remains scheduled every six hours', () => {
  assert.match(workflow, /cron:\s*['"]17 \*\/6 \* \* \*['"]/)
})
test('Maya health workflow can also be run manually', () => {
  assert.match(workflow, /workflow_dispatch:/)
})
test('Maya scheduled health check targets the correct production endpoint', () => {
  assert.match(workflow, /https:\/\/maya-steel-works-mgt\.vercel\.app\/api\/health\/supabase/)
})
test('Maya health workflow uses a protected GitHub secret', () => {
  assert.match(workflow, /secrets\.MAYA_HEALTHCHECK_SECRET/)
  assert.match(workflow, /Authorization: Bearer \$HEALTHCHECK_SECRET/)
})
test('Maya health endpoint rejects unauthorized requests and disables caching', () => {
  assert.match(endpoint, /process\.env\.HEALTHCHECK_SECRET/)
  assert.match(endpoint, /status: 401/)
  assert.match(endpoint, /force-dynamic/)
  assert.match(endpoint, /no-store/)
})
test('Maya endpoint performs real Supabase database I\/O instead of a static heartbeat', () => {
  assert.match(endpoint, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(endpoint, /supabase\.from\('users'\)\.select\('id'\)\.limit\(1\)/)
  assert.match(endpoint, /database: 'reachable'/)
})
test('Maya workflow rejects old or invalid successful-looking responses', () => {
  assert.match(workflow, /Date\.parse\(result\.checked_at/)
  assert.match(workflow, /age > 180000/)
  assert.match(workflow, /result\.database !== "reachable"/)
})
test('Maya workflow never follows redirected endpoints with its bearer secret', () => {
  assert.doesNotMatch(workflow, /--location\b|\s-L\b/)
})
