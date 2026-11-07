import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCustomJobPayload, jobTotals, groupSalesByJob, parseJobLabel, stripJobSuffix, isJobLine, MAX_JOB_MATERIALS,
} from '../lib/customJob.mjs'
import { buildPeriodReport } from '../lib/mayaPeriodReport.mjs'

const half = { raw_id: 9101, raw_units: '0.5', unit_price: '100000' }
const form = (extra = {}) => ({ description: 'Ribbed plate, half sheet', status: 'paid', materials: [half], labour: '20000', ...extra })
const refuses = (input, pattern) => assert.throws(() => buildCustomJobPayload(input), (e) => e instanceof RangeError && pattern.test(e.message))

test('the half-sheet example: metal and labour are charged separately and add up', () => {
  const { payload, totals } = buildCustomJobPayload(form({ customer: ' Alpha ' }))
  assert.deepEqual(payload, {
    description: 'Ribbed plate, half sheet',
    materials: [{ raw_id: 9101, raw_units: 0.5, unit_price: 100000 }],
    labour_amount: 20000, payment_status: 'paid', customer_name: 'Alpha',
  })
  assert.deepEqual(totals, { lines: [50000], material: 50000, labour: 20000, total: 70000 })
})

test('a blank customer is left out of the request (the database records Walk-in)', () => {
  const { payload } = buildCustomJobPayload(form({ customer: '   ' }))
  assert.equal('customer_name' in payload, false)
})

test('labour is optional and may be left blank', () => {
  for (const labour of ['', undefined, null, '0', 0]) {
    const { payload, totals } = buildCustomJobPayload(form({ labour }))
    assert.equal(payload.labour_amount, 0)
    assert.equal(totals.total, 50000)
  }
})

test('any stock item and any fraction up to three decimals works; more is refused', () => {
  for (const units of ['0.25', '0.333', '1', '12.5', '0.001']) {
    assert.doesNotThrow(() => buildCustomJobPayload(form({ materials: [{ ...half, raw_units: units }] })))
  }
  refuses(form({ materials: [{ ...half, raw_units: '0.0001' }] }), /3 decimal/)
  refuses(form({ materials: [{ ...half, raw_units: '0' }] }), /how much was used/)
  refuses(form({ materials: [{ ...half, raw_units: '-1' }] }), /how much was used/)
  refuses(form({ materials: [{ ...half, raw_units: '' }] }), /how much was used/)
})

test('several stock items in one job, up to the limit', () => {
  const two = [half, { raw_id: 9102, raw_units: '3', unit_price: '5000' }]
  const { payload, totals } = buildCustomJobPayload(form({ materials: two, labour: '0' }))
  assert.equal(payload.materials.length, 2)
  assert.deepEqual(totals.lines, [50000, 15000])
  assert.equal(totals.total, 65000)
  const many = Array.from({ length: MAX_JOB_MATERIALS }, () => half)
  assert.doesNotThrow(() => buildCustomJobPayload(form({ materials: many })))
  refuses(form({ materials: [...many, half] }), /at most 8/)
  refuses(form({ materials: [] }), /Choose the stock/)
})

test('the form is checked like the database checks it', () => {
  refuses(form({ description: 'ab' }), /Describe the job/)
  refuses(form({ description: '   ' }), /Describe the job/)
  refuses(form({ description: 'x'.repeat(201) }), /under 200/)
  refuses(form({ status: 'later' }), /Paid, Partial or Credit/)
  refuses(form({ materials: [{ ...half, raw_id: '' }] }), /choose the stock item/)
  refuses(form({ materials: [{ ...half, unit_price: '0' }] }), /price of one whole unit/)
  refuses(form({ materials: [{ ...half, unit_price: '' }] }), /price of one whole unit/)
  refuses(form({ labour: '-5' }), /zero or more/)
  refuses(form({ labour: 'lots' }), /zero or more/)
})

test('credit and part payment need a customer; part payment must be between zero and the total', () => {
  refuses(form({ status: 'credit' }), /customer name/)
  refuses(form({ status: 'partial', paidAmount: '1000' }), /customer name/)
  assert.equal(buildCustomJobPayload(form({ status: 'credit', customer: 'Beta' })).payload.payment_status, 'credit')
  const ok = buildCustomJobPayload(form({ status: 'partial', customer: 'Beta', paidAmount: '30000' }))
  assert.equal(ok.payload.amount_paid, 30000)
  refuses(form({ status: 'partial', customer: 'Beta', paidAmount: '0' }), /more than 0 and less than/)
  refuses(form({ status: 'partial', customer: 'Beta', paidAmount: '' }), /more than 0 and less than/)
  refuses(form({ status: 'partial', customer: 'Beta', paidAmount: '70000' }), /more than 0 and less than/)
  refuses(form({ status: 'partial', customer: 'Beta', paidAmount: '80000' }), /more than 0 and less than/)
  assert.equal('amount_paid' in buildCustomJobPayload(form({ status: 'paid' })).payload, false)
})

test('an obvious over-draw is caught before sending, counting the same item picked twice', () => {
  const available = { 9101: 1 }
  assert.doesNotThrow(() => buildCustomJobPayload(form({ available })))
  refuses(form({ materials: [{ ...half, raw_units: '1.5' }], available, units: { 9101: 'sheets' } }), /Only 1 sheets .* uses 1\.5/)
  refuses(form({ materials: [half, { ...half, raw_units: '0.75' }], available }), /uses 1\.25/)
})

test('totals do not drift on fractions of a sheet', () => {
  const t = jobTotals([{ raw_units: '0.333', unit_price: '3000' }, { raw_units: '0.1', unit_price: '0.3' }], '0.1')
  assert.deepEqual(t.lines, [999, 0.03])
  assert.equal(t.material, 999.03)
  assert.equal(t.total, 999.13)
  assert.deepEqual(jobTotals([], ''), { lines: [], material: 0, labour: 0, total: 0 })
})

test('job labels: the ending links the lines of one job', () => {
  assert.deepEqual(parseJobLabel('Plain plates 1.2mm 4 x 8ft (job #12)'), { base: 'Plain plates 1.2mm 4 x 8ft', jobId: 12 })
  assert.deepEqual(parseJobLabel('Plain plates 1.2mm'), { base: 'Plain plates 1.2mm', jobId: null })
  assert.deepEqual(parseJobLabel(null), { base: '', jobId: null })
  assert.equal(stripJobSuffix('Labour - Ribbed plate (half sheet) (job #12)'), 'Labour - Ribbed plate (half sheet)')
  assert.equal(stripJobSuffix('Customer Material - Louvers'), 'Customer Material - Louvers')
  // only the real ending counts
  assert.equal(parseJobLabel('Job #12 plates').jobId, null)
  assert.equal(parseJobLabel('Plates (job #12) extra').jobId, null)
})

test('only lines written by a custom job are treated as job lines', () => {
  assert.equal(isJobLine({ item_type: 'raw', item_label: 'Plates (job #5)' }), true)
  assert.equal(isJobLine({ item_type: 'service', item_label: 'Labour - Louvers (job #5)' }), true)
  assert.equal(isJobLine({ item_type: 'service', item_label: 'Customer Material - Louvers (job #5)' }), false)
  assert.equal(isJobLine({ item_type: 'finished', item_label: 'Louvers (job #5)' }), false)
  assert.equal(isJobLine({ item_type: 'raw', item_label: 'Plates' }), false)
  assert.equal(isJobLine(null), false)
})

const row = (id, extra) => ({ id, created_at: '2026-11-07T08:00:00Z', customer_name: 'Alpha', quantity: 1, unit_price: 100, total_amount: 100, amount_paid: 100, payment_status: 'paid', item_type: 'raw', item_label: 'Plates', ...extra })

test("today's list shows a job as one entry and ordinary sales as they were", () => {
  // newest first, like the page loads them
  const sales = [
    row(14, { item_label: 'Louvers 1mm' , item_type: 'finished' }),
    row(13, { item_type: 'service', item_label: 'Labour - Ribbed plate, half sheet (job #11)', total_amount: 20000, amount_paid: 20000 }),
    row(12, { item_label: 'Kibaati 1.5mm 8ft (job #11)', quantity: 3, total_amount: 15000, amount_paid: 15000 }),
    row(11, { item_label: 'Plain plates 1.2mm 4 x 8ft (job #11)', quantity: 0.5, total_amount: 50000, amount_paid: 50000 }),
    row(10, { item_type: 'service', item_label: 'Customer Material - Ribbed plate' }),
  ]
  const entries = groupSalesByJob(sales)
  assert.deepEqual(entries.map((e) => e.kind), ['sale', 'job', 'sale'])
  const job = entries[1]
  assert.equal(job.jobId, 11)
  assert.equal(job.description, 'Ribbed plate, half sheet')
  assert.deepEqual(job.materials.map((m) => m.id), [11, 12])
  assert.equal(job.labour.id, 13)
  assert.equal(job.total, 85000)
  assert.equal(job.paid, 85000)
  assert.equal(job.status, 'paid')
  assert.equal(entries[0].sale.id, 14)
  assert.equal(entries[2].sale.id, 10)
})

test('a part-paid or unpaid job shows the right status and amounts', () => {
  const lines = (paidMetal, paidLabour) => [
    row(22, { item_type: 'service', item_label: 'Labour - Cut (job #21)', total_amount: 10000, amount_paid: paidLabour }),
    row(21, { item_label: 'Plates (job #21)', total_amount: 25000, amount_paid: paidMetal }),
  ]
  const [partial] = groupSalesByJob(lines(25000, 5000))
  assert.deepEqual([partial.status, partial.paid, partial.total], ['partial', 30000, 35000])
  const [credit] = groupSalesByJob(lines(0, 0))
  assert.deepEqual([credit.status, credit.paid], ['credit', 0])
  const [metalOnly] = groupSalesByJob([row(31, { item_label: 'Plates (job #31)' })])
  assert.equal(metalOnly.labour, null)
  assert.equal(metalOnly.description, '')
})

test('two different jobs, or the same job number for another customer, stay separate', () => {
  const entries = groupSalesByJob([
    row(5, { item_label: 'Plates (job #4)', customer_name: 'A' }),
    row(4, { item_label: 'Plates (job #4)', customer_name: 'B' }),
    row(3, { item_label: 'Plates (job #2)', customer_name: 'A' }),
  ])
  assert.equal(entries.length, 3)
  assert.deepEqual(groupSalesByJob(null), [])
})

// ---- what a job does to the reports ----

const jobSales = (day = '2026-11-02') => [
  { id: 11, created_at: `${day}T09:00:00Z`, item_type: 'raw', item_id: 9101, quantity: 0.5, unit_price: 100000, total_amount: 50000, amount_paid: 50000, adjustments: 0, item_label: 'Plain plates 1.2mm 4 x 8ft (job #11)', customer_name: 'Alpha', sold_by: 'u1' },
  { id: 12, created_at: `${day}T09:00:00Z`, item_type: 'service', item_id: 0, quantity: 1, unit_price: 20000, total_amount: 20000, amount_paid: 20000, adjustments: 0, item_label: 'Labour - Ribbed plate (job #11)', customer_name: 'Alpha', sold_by: 'u1' },
]
const periodReport = (sales, unitCosts = { 'raw-9101': 80000 }) =>
  buildPeriodReport({ from: '2026-11-01', to: '2026-11-03', now: new Date('2026-12-01T10:00:00Z'), sales, unitCosts })

test('period report: metal counts as stock sales with the cost of the part used; labour counts as service income with no cost', () => {
  const r = periodReport(jobSales())
  assert.equal(r.totals.stockSales, 50000)
  assert.equal(r.totals.serviceSales, 20000)
  assert.equal(r.totals.grossSales, 70000)
  assert.equal(r.totals.cashReceived, 70000)
  assert.equal(r.totals.estimatedCostOfGoods, 40000) // half of a sheet that cost 80,000
  assert.equal(r.totals.estimatedGrossProfit, 30000) // 10,000 on the metal + all 20,000 of the labour
})

test('period report: an unpaid job is owed, and its metal still costs money', () => {
  const unpaid = jobSales().map((s) => ({ ...s, amount_paid: 0 }))
  const r = periodReport(unpaid)
  assert.equal(r.totals.cashReceived, 0)
  assert.equal(r.totals.outstanding, 70000)
  assert.equal(r.totals.estimatedCostOfGoods, 40000)
})

test('period report: the same work done twice is one line in the top items, without the job number', () => {
  const second = jobSales('2026-11-03').map((s) => ({ ...s, id: s.id + 10, item_label: s.item_label.replace('#11', '#21') }))
  const r = periodReport([...jobSales(), ...second])
  const labels = r.topItems.map((i) => i.label)
  assert.deepEqual(labels.sort(), ['Labour - Ribbed plate', 'Plain plates 1.2mm 4 x 8ft'])
  const labour = r.topItems.find((i) => i.label === 'Labour - Ribbed plate')
  assert.equal(labour.sales, 40000)
  assert.equal(labour.quantity, 2)
  const metal = r.topItems.find((i) => i.label === 'Plain plates 1.2mm 4 x 8ft')
  assert.equal(metal.sales, 100000)
  assert.equal(metal.quantity, 1)
})
