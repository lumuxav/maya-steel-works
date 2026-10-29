import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
const require = createRequire(import.meta.url)
const root = new URL('../../', import.meta.url).pathname
const user = { id: '11111111-1111-1111-1111-111111111111', email: 'fixture@example.invalid' }
const profile = { ...user, full_name: 'Fixture Manager', role: 'admin', active: true, branch: 'Maya Branch' }
const at = (day) => `${day}T09:00:00Z`
const tables = {
  users: [profile], corrections_log: [], raw_materials_admin_view: [], stock_movements: [], production_log: [], expense_categories: [{ id: 1, name: 'Fuel' }],
  sales: [{ id: 1, item_type: 'service', item_id: 0, item_label: 'Customer Material - Pressing', quantity: 1, total_amount: 1000, amount_paid: 600, adjustments: 0, created_at: at('2026-10-31'), sold_by: user.id }],
  debt_events: [{ id: 1, sale_id: 1, event_type: 'payment', amount: 400, created_at: at('2026-11-01'), received_by: user.id }],
  expenses: [{ id: 1, amount: 50, category: 'Fuel', description: 'Generator fuel', created_at: at('2026-11-01'), recorded_by: user.id }],
  bankings: [{ id: 1, amount_banked: 100, banking_date: '2026-11-01', status: 'confirmed', created_at: at('2026-11-01'), recorded_by: user.id }],
}
let queries = 0
const fixture = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range')
  if (req.method === 'OPTIONS') return res.end()
  const url = new URL(req.url, 'http://fixture')
  if (url.pathname === '/auth/v1/user') return res.end(JSON.stringify(user))
  if (url.pathname.startsWith('/rest/v1/')) {
    queries += 1
    const table = url.pathname.split('/').at(-1)
    let rows = tables[table] || []
    if (url.searchParams.has('id')) rows = rows.filter(row => String(row.id) === url.searchParams.get('id').replace('eq.', ''))
    const count = rows.length
    const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || count)
    rows = rows.slice(offset, offset + limit)
    res.setHeader('Content-Range', `${offset}-${Math.max(offset, offset + rows.length - 1)}/${count}`)
    if (req.method === 'HEAD') return res.end()
    const single = (req.headers.accept || '').includes('vnd.pgrst.object')
    return res.end(JSON.stringify(single ? rows[0] : rows))
  }
  res.statusCode = 404; res.end('{}')
})
await new Promise(resolve => fixture.listen(3107, '127.0.0.1', resolve))
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3100'], {
  cwd: root,
  env: { ...process.env, NODE_OPTIONS: `--require=${root}tests/browser/fixture-runtime.cjs`, NEXT_PUBLIC_SUPABASE_URL: 'https://ci-placeholder.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ci-placeholder-public-key-no-live-access' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', data => { serverLog += data })
server.stderr.on('data', data => { serverLog += data })
let browser
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch('http://127.0.0.1:3100/login')).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  const apiCheck = await fetch('http://127.0.0.1:3100/api/reports/period?from=2026-10-31&to=2026-11-02', { headers: { Authorization: 'Bearer fixture-token' } })
  const apiBody = await apiCheck.json()
  assert.equal(apiCheck.status, 200, JSON.stringify(apiBody))
  assert.equal(apiBody.report.totals.cashReceived, 600)
  assert.equal(apiBody.report.totals.closingCash, 450)
  console.log('PASS real Next API → Supabase HTTP fixture → accurate report')
  if (!process.env.MAYA_TEST_API_ONLY) {
  browser = await chromium.launch({ headless: true, ...(process.env.MAYA_TEST_CHROMIUM ? { executablePath: process.env.MAYA_TEST_CHROMIUM } : {}), args: ['--no-sandbox'] })
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' })
    const page = await context.newPage()
    await page.clock.install({ time: new Date('2026-11-04T10:00:00Z') })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('https://ci-placeholder.supabase.co/**', async route => {
      const result = await route.fetch({ url: route.request().url().replace('https://ci-placeholder.supabase.co', 'http://127.0.0.1:3107') })
      await route.fulfill({ response: result })
    })
    await page.addInitScript(({ user }) => {
      const encode = value => btoa(JSON.stringify(value)).replaceAll('=', '')
      const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: 2000000000 })}.fixture`
      localStorage.setItem('sb-ci-placeholder-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture', token_type: 'bearer', expires_at: 2000000000, user }))
      localStorage.setItem('maya-theme', 'dark')
    }, { user })
    await page.goto('http://127.0.0.1:3100/profit')
    await page.getByRole('button', { name: 'Export CSV' }).waitFor()
    await page.getByLabel('From', { exact: true }).fill('2026-10-31')
    await page.getByLabel('To (inclusive)', { exact: true }).fill('2026-11-02')
    const resultPromise = page.waitForResponse(res => res.url().includes('/api/reports/period?') && res.request().method() === 'GET')
    await page.getByRole('button', { name: 'View report', exact: true }).click()
    const response = await resultPromise
    assert.equal(response.status(), 200)
    const payload = await response.json()
    assert.equal(payload.report.totals.grossSales, 1000)
    assert.equal(payload.report.totals.cashReceived, 600)
    assert.equal(payload.report.totals.closingCash, 450)
    assert.equal(payload.report.totals.outstanding, 400)
    await page.getByRole('button', { name: 'Export CSV' }).waitFor()
    assert.ok(await page.getByRole('heading', { name: 'Cash reconciliation' }).isVisible())
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `horizontal page overflow at ${width}px`)
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export CSV' }).click()
    const download = await downloadPromise
    assert.equal(download.suggestedFilename(), 'Maya-Period-Report-2026-10-31-to-2026-11-02.csv')
    const csv = await readFile(await download.path(), 'utf8')
    assert.match(csv, /2026-11-02/)
    assert.match(csv, /"cashReceived","600"/)
    await mkdir('/tmp/maya-report-qa', { recursive: true })
    await page.screenshot({ path: `/tmp/maya-report-qa/report-${width}.png`, fullPage: true })
    await page.evaluate(() => {
      window.mayaExportCalls = []
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          Filesystem: { writeFile: async options => { window.mayaExportCalls.push(options); return { uri: 'file:///cache/fixture.csv' } } },
          Share: { share: async options => { window.mayaExportCalls.push(options) } },
        },
      }
    })
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
    await page.waitForFunction(() => window.mayaExportCalls.length === 2)
    const exportCalls = await page.evaluate(() => window.mayaExportCalls)
    assert.equal(exportCalls[0].directory, 'CACHE')
    assert.equal(exportCalls[0].encoding, 'utf8')
    assert.match(exportCalls[0].data, /"cashReceived","600"/)
    assert.deepEqual(exportCalls[1].files, ['file:///cache/fixture.csv'])
    await page.evaluate(() => { delete window.Capacitor })
    await page.getByLabel('From', { exact: true }).fill('2026-11-10')
    await page.getByRole('button', { name: 'View report', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').innerText(), /start date/)
    assert.equal(await page.getByRole('button', { name: 'Export CSV' }).count(), 0)
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS ${width}px: authenticated browser → API → paginated fixture database → exact totals → CSV; invalid dates clear prior report; no page overflow or runtime errors`)
  }
  }
  const anonymous = await fetch('http://127.0.0.1:3100/api/reports/period?from=2026-10-31&to=2026-11-02')
  assert.equal(anonymous.status, 401)
  assert.ok(queries >= 18)
  console.log(`PASS anonymous access denied; ${queries} fixture database requests; no live database touched`)
} catch (error) {
  console.error(serverLog.slice(-6000))
  throw error
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  await new Promise(resolve => fixture.close(resolve))
}
