import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPeriodReport, validatePeriod, periodPreset, estimateUnitCosts, periodReportCsv } from '../lib/mayaPeriodReport.mjs'
import { readAllRows } from '../lib/mayaReportData.mjs'
import { handlePeriodReport } from '../lib/mayaPeriodApi.mjs'

const sale = (id, day, total, paid, extra = {}) => ({ id, created_at: `${day}T09:00:00Z`, total_amount: total, amount_paid: paid, adjustments: 0, item_type: 'service', item_id: 0, quantity: 1, sold_by: 'admin', ...extra })
const report = (extra = {}) => buildPeriodReport({ from: '2026-10-31', to: '2026-11-02', now: new Date('2026-12-01T10:00:00Z'), ...extra })
const payments = [
  { id: 1, sale_id: 1, event_type: 'payment', amount: 200, created_at: '2026-11-01T08:00:00Z' },
  { id: 2, sale_id: 1, event_type: 'payment', amount: 100, created_at: '2026-11-03T08:00:00Z' },
]

test('both Uganda calendar boundaries include the entire first and last day', () => {
  const rows = ['2026-10-30T20:59:59.999Z', '2026-10-30T21:00:00Z', '2026-10-31T20:59:59.999Z', '2026-10-31T21:00:00Z'].map((created_at, id) => sale(id, '2026-10-31', 100, 100, { created_at }))
  const result = report({ to: '2026-10-31', sales: rows })
  assert.equal(result.totals.cashReceived, 200)
  assert.equal(result.saleCount, 2)
})
test('repayments after period end do not change earlier cash or outstanding', () => {
  const r = report({ to: '2026-10-31', sales: [sale(1, '2026-10-31', 1000, 400)], events: payments })
  assert.equal(r.totals.cashReceived, 100)
  assert.equal(r.totals.outstanding, 900)
  assert.equal(r.totals.grossSales, 1000)
})
test('repayment of a previous-period invoice is cash but not a new sale', () => {
  const r = report({ from: '2026-11-01', to: '2026-11-01', sales: [sale(1, '2026-10-31', 1000, 400)], events: payments })
  assert.equal(r.totals.openingCash, 100)
  assert.equal(r.totals.cashReceived, 200)
  assert.equal(r.totals.grossSales, 0)
  assert.equal(r.totals.closingCash, 300)
})
test('cash at sale and subsequent payments are counted exactly once', () => {
  const r = report({ sales: [sale(1, '2026-10-31', 1000, 400)], events: payments })
  assert.equal(r.totals.cashReceived, 300)
  assert.equal(r.totals.initialCash, 100)
  assert.equal(r.totals.repayments, 200)
  assert.equal(r.totals.outstanding, 700)
})
test('advances increase cash without inflating sales', () => {
  const r = report({ events: [{ ...payments[0], sale_id: null }] })
  assert.equal(r.totals.advances, 200)
  assert.equal(r.totals.netSales, 0)
  assert.equal(r.totals.cashReceived, 200)
})
test('adjustments follow event dates and never count as cash', () => {
  const events = [{ ...payments[0], event_type: 'compensation', amount: 50 }, { ...payments[1], event_type: 'return', amount: 30 }]
  const sales = [sale(1, '2026-10-31', 1000, 100, { adjustments: 80 })]
  const r = report({ sales, events })
  assert.equal(r.totals.adjustments, 50)
  assert.equal(r.totals.netSales, 950)
  assert.equal(r.totals.outstanding, 850)
  assert.equal(r.totals.cashReceived, 100)
})
test('undated historical adjustments make historical debt unavailable', () => {
  const r = report({ sales: [sale(1, '2026-10-31', 1000, 100, { adjustments: 200 })] })
  assert.equal(r.totals.outstanding, null)
  assert.match(r.notes.join(' '), /without dated events/)
})
test('pending bankings do not reduce cash or profit', () => {
  const r = report({ sales: [sale(1, '2026-10-31', 1000, 1000)], expenses: [{ amount: 100, category: 'Fuel', created_at: '2026-11-01T09:00:00Z' }], bankings: [
    { banking_date: '2026-10-31', amount_banked: 200, status: 'confirmed' },
    { banking_date: '2026-11-01', amount_banked: 500, status: 'pending' },
  ] })
  assert.equal(r.totals.closingCash, 700)
  assert.equal(r.totals.pendingBanking, 500)
  assert.equal(r.totals.estimatedNetProfit, 900)
  assert.equal(r.totals.netCashFlow, 900)
  assert.equal(r.expenseCategories[0].total, 100)
  assert.equal(r.daily.length, 3)
  assert.equal(r.daily[2].closingCash, 700)
})
test('negative ledger balances remain visible', () => {
  const r = report({ expenses: [{ amount: 100, created_at: '2026-10-31T09:00:00Z' }] })
  assert.equal(r.totals.closingCash, -100)
  assert.match(r.notes.join(' '), /cash deficit/)
})
test('pre-launch history is excluded and launch day is included', () => {
  const r = report({ from: '2026-10-01', to: '2026-10-31', sales: [sale(1, '2026-10-30', 900, 900), sale(2, '2026-10-31', 100, 100)] })
  assert.equal(r.totals.cashReceived, 100)
  assert.equal(r.operatingDays, 1)
  assert.equal(r.effectiveFrom, '2026-10-31')
})
test('before launch there are no invented days or operating balances', () => {
  const r = report({ now: new Date('2026-10-30T12:00:00Z') })
  assert.equal(r.operatingDays, 0)
  assert.equal(r.totals.closingCash, 0)
})
test('future ranges never generate forecast sales or cash balances', () => {
  const r = report({ from: '2026-12-10', to: '2026-12-31', sales: [sale(1, '2026-10-31', 100, 100)] })
  assert.equal(r.operatingDays, 0)
  assert.equal(r.totals.openingCash, 0)
})
test('arbitrary cross-month and leap-year dates work', () => {
  assert.equal(report({ from: '2027-06-24', to: '2027-08-22', now: new Date('2027-09-01') }).daily.length, 60)
  assert.equal(report({ from: '2028-02-28', to: '2028-03-01', now: new Date('2028-04-01') }).daily.length, 3)
})
test('same-day range works and invalid or reversed ranges fail', () => {
  assert.deepEqual(validatePeriod('2026-10-31', '2026-10-31'), { from: '2026-10-31', to: '2026-10-31' })
  for (const [from, to] of [['', '2026-11-01'], ['2026-11-02', '2026-11-01'], ['2026-02-30', '2026-11-01'], ['2026-1-1', '2026-11-01']]) assert.throws(() => validatePeriod(from, to), RangeError)
})
test('presets are calendar based and the last 7 days includes today', () => {
  assert.deepEqual(periodPreset('7d', '2026-11-07'), { from: '2026-11-01', to: '2026-11-07' })
  assert.deepEqual(periodPreset('last-month', '2027-01-15'), { from: '2026-12-01', to: '2026-12-31' })
})
test('missing costs are unavailable instead of zero-cost profit', () => {
  const r = report({ sales: [sale(1, '2026-10-31', 1000, 1000, { item_type: 'raw', item_id: 1 })] })
  assert.equal(r.totals.estimatedNetProfit, null)
  assert.equal(r.totals.netSales, 1000)
})
test('known batch costs generate an explicitly estimated profit', () => {
  const costs = estimateUnitCosts([{ id: 1, total_landed_cost: 500 }], [{ item_id: 1, item_type: 'raw', movement_type: 'received', quantity_change: 10 }], [{ raw_material_id: 1, finished_good_id: 7, raw_units_used: 2, actual_yield: 5 }])
  assert.equal(costs['raw-1'], 50)
  assert.equal(costs['finished-7'], 20)
  const r = report({ unitCosts: costs, sales: [sale(1, '2026-10-31', 1000, 1000, { item_type: 'finished', item_id: 7, quantity: 3 })] })
  assert.equal(r.totals.estimatedNetProfit, 940)
})
test('CSV has all days, amounts, dates, notes and escaped customer-supplied labels', () => {
  const r = report({ sales: [sale(1, '2026-10-31', 100, 100, { item_label: '=HYPERLINK("bad")' })] })
  const csv = periodReportCsv(r)
  assert.match(csv, /2026-11-02/)
  assert.match(csv, /Africa\/Kampala/)
  assert.match(csv, /'=HYPERLINK\(""bad""\)/)
})
test('more than 1000 records are loaded even when server page cap is smaller', async () => {
  const source = Array.from({ length: 1207 }, (_, id) => ({ id }))
  const rows = await readAllRows(() => ({ order() { return this }, async range(start, end) { return { data: source.slice(start, Math.min(end + 1, start + 250)), count: source.length } } }))
  assert.equal(rows.length, 1207)
  assert.equal(rows.at(-1).id, 1206)
})
test('pagination refuses partial errors and changing row counts', async () => {
  await assert.rejects(() => readAllRows(() => ({ order() { return this }, async range() { return { error: { message: 'failed' } } } })))
  let page = 0
  await assert.rejects(() => readAllRows(() => ({ order() { return this }, async range() { return ++page === 1 ? { data: [{ id: 1 }], count: 2 } : { data: [{ id: 2 }], count: 3 } } })), /changed/)
})

const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-public-key' }
function fakeClient({ profile = { role: 'admin', active: true, branch: 'Maya Branch' }, fail = '', authError = false, tables = {} } = {}) {
  return () => ({
    auth: { async getUser() { return { data: { user: authError ? null : { id: 'admin' } }, error: authError } } },
    from(table) {
      const rows = tables[table] || (table === 'users' ? [{ id: 'admin', branch: 'Maya Branch' }] : [])
      return {
        select(_cols, opts) { this.head = opts?.head; return this }, eq() { return this },
        async single() { return { data: profile } }, order() { return this },
        async range(start, end) { return { data: rows.slice(start, end + 1), count: rows.length, error: table === fail ? { message: 'private failure' } : null } },
        then(resolve) { resolve({ count: rows.length, error: null }) },
      }
    },
  })
}
const req = (query = 'from=2026-10-31&to=2026-11-02', token = 'fixture') => new Request(`https://maya.test/api/reports/period?${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
test('anonymous callers cannot access financial reports', async () => assert.equal((await handlePeriodReport(req('', ''), { createClient: fakeClient(), env })).status, 401))
test('invalid sessions are denied', async () => assert.equal((await handlePeriodReport(req(), { createClient: fakeClient({ authError: true }), env })).status, 401))
test('employees, disabled managers and other branches are denied server-side', async () => {
  for (const profile of [{ role: 'employee', active: true, branch: 'Maya Branch' }, { role: 'admin', active: false, branch: 'Maya Branch' }, { role: 'admin', active: true, branch: 'Other' }]) {
    assert.equal((await handlePeriodReport(req(), { createClient: fakeClient({ profile }), env })).status, 403)
  }
})
test('bad ranges return validation errors with no report', async () => assert.equal((await handlePeriodReport(req('from=2026-11-02&to=2026-10-31'), { createClient: fakeClient(), env })).status, 400))
test('core database failures cannot become false zero totals', async () => {
  const result = await handlePeriodReport(req(), { createClient: fakeClient({ fail: 'sales' }), env })
  assert.equal(result.status, 503)
  assert.equal((await result.json()).report, undefined)
})
test('authenticated API isolates Maya records and disables caching', async () => {
  const result = await handlePeriodReport(req(), { createClient: fakeClient({ tables: {
    users: [{ id: 'admin', branch: 'Maya Branch' }, { id: 'other', branch: 'Other' }],
    sales: [sale(1, '2026-10-31', 100, 100), sale(2, '2026-10-31', 900, 900, { sold_by: 'other' })],
  } }), env, now: () => new Date('2026-12-01') })
  assert.equal(result.status, 200)
  assert.match(result.headers.get('Cache-Control'), /no-store/)
  assert.equal((await result.json()).report.totals.netSales, 100)
})
