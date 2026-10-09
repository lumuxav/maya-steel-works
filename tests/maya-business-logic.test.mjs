import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAYA_LAUNCH_DAY, MAYA_TIME_ZONE, mayaBusinessDay, addBusinessDays,
  businessArchiveDays, amount, saleCashAtTransaction, outstandingBalance,
  receivedOnDay, closingCash, openingCashForDay
} from '../lib/mayaBusiness.mjs'

const sale = (overrides = {}) => ({
  id: 1, item_type: 'finished', created_at: '2026-10-12T07:00:00Z',
  total_amount: 1000, amount_paid: 400, adjustments: 0, ...overrides
})
const event = (overrides = {}) => ({
  sale_id: 1, event_type: 'payment', amount: 100,
  created_at: '2026-10-13T08:00:00Z', ...overrides
})
const expense = (overrides = {}) => ({
  amount: 50, created_at: '2026-10-12T09:00:00Z', ...overrides
})
const banking = (overrides = {}) => ({
  amount_banked: 100, banking_date: '2026-10-12', status: 'confirmed', ...overrides
})

test('Maya official launch date is Monday 12 October 2026', () => {
  assert.equal(MAYA_LAUNCH_DAY, '2026-10-12')
  assert.equal(new Date(MAYA_LAUNCH_DAY + 'T12:00:00Z').getUTCDay(), 1)
})
test('business time zone is Uganda', () => assert.equal(MAYA_TIME_ZONE, 'Africa/Kampala'))
test('Kampala business day is still October 11 before 21:00 UTC', () => assert.equal(mayaBusinessDay('2026-10-11T20:59:59Z'), '2026-10-11'))
test('Kampala Monday starts at 21:00 UTC on Sunday', () => assert.equal(mayaBusinessDay('2026-10-11T21:00:00Z'), '2026-10-12'))
test('Kampala midnight at UTC 21:00 increments business date', () => assert.equal(mayaBusinessDay('2026-10-12T21:00:00Z'), '2026-10-13'))
test('Kampala business date preserves noon', () => assert.equal(mayaBusinessDay('2026-10-12T09:00:00Z'), '2026-10-12'))
test('bad timestamps are rejected', () => assert.throws(() => mayaBusinessDay('not a date'), RangeError))
test('add a business day', () => assert.equal(addBusinessDays('2026-10-12', 1), '2026-10-13'))
test('subtract a business day', () => assert.equal(addBusinessDays('2026-10-12', -1), '2026-10-11'))
test('month rollover works', () => assert.equal(addBusinessDays('2026-10-31', 1), '2026-11-01'))
test('year rollover works', () => assert.equal(addBusinessDays('2026-12-31', 1), '2027-01-01'))
test('leap day works', () => assert.equal(addBusinessDays('2028-02-28', 1), '2028-02-29'))
test('date shift rejects invalid input', () => assert.throws(() => addBusinessDays('bad', 1), RangeError))
test('date shift rejects fractional day', () => assert.throws(() => addBusinessDays('2026-10-12', .5), RangeError))
test('pre-launch archive has no days', () => assert.deepEqual(businessArchiveDays(MAYA_LAUNCH_DAY, '2026-10-11'), []))
test('launch archive has one day', () => assert.deepEqual(businessArchiveDays(MAYA_LAUNCH_DAY, MAYA_LAUNCH_DAY), [MAYA_LAUNCH_DAY]))
test('archive is reverse chronological', () => assert.deepEqual(businessArchiveDays(MAYA_LAUNCH_DAY, '2026-10-14'), ['2026-10-14', '2026-10-13', '2026-10-12']))
test('normal number formats parse', () => assert.equal(amount('1.5'), 1.5))
test('missing numbers are safe zeros', () => assert.equal(amount(undefined), 0))
test('nonnumeric numbers are safe zeros', () => assert.equal(amount('bad'), 0))
test('sale paid in full at transaction has immediate cash', () => assert.equal(saleCashAtTransaction(sale({amount_paid: 1000}), []), 1000))
test('credit sale has no initial cash', () => assert.equal(saleCashAtTransaction(sale({amount_paid:0}), []), 0))
test('subsequent repayments are not counted at original sale time', () => assert.equal(saleCashAtTransaction(sale(), [event()]), 300))
test('events for another sale do not affect initial cash', () => assert.equal(saleCashAtTransaction(sale(), [event({sale_id:2})]), 400))
test('compensation events are not cash receipts', () => assert.equal(saleCashAtTransaction(sale(), [event({event_type:'compensation'})]), 400))
test('excess later-payments cannot make initial cash negative', () => assert.equal(saleCashAtTransaction(sale(), [event({amount:900})]), 0))
test('new credit balance after partial payment', () => assert.equal(outstandingBalance(sale()), 600))
test('adjustments reduce debt', () => assert.equal(outstandingBalance(sale({adjustments:100})), 500))
test('overpayments do not generate negative outstanding', () => assert.equal(outstandingBalance(sale({amount_paid:1200})), 0))
test('cash received on sale day excludes next-day repayment', () => assert.equal(receivedOnDay([sale()], [event()], MAYA_LAUNCH_DAY), 300))
test('cash received next day includes repayment once', () => assert.equal(receivedOnDay([sale()], [event()], '2026-10-13'), 100))
test('no transactions mean zero cash', () => assert.equal(receivedOnDay([], [], MAYA_LAUNCH_DAY), 0))
test('customer-owned-material service receipts are included', () => assert.equal(receivedOnDay([sale({id:3,item_type:'service',amount_paid:500})], [], MAYA_LAUNCH_DAY), 500))
test('unassigned account advances are cash on receipt date', () => assert.equal(receivedOnDay([], [event({sale_id:null})], '2026-10-13'), 100))
test('closing cash subtracts expenses and confirmed banking', () => assert.equal(closingCash(200,300,50,100), 350))
test('closing cash never goes negative', () => assert.equal(closingCash(0,10,0,200), 0))
test('opening cash excludes transactions before launch', () => {
  const old = sale({id: 4, amount_paid: 900, created_at:'2026-10-10T12:00:00Z'})
  assert.equal(openingCashForDay([old],[],[],[], '2026-10-13'), 0)
})
test('next-day opening carries paid cash, minus expenses and confirmed bankings', () => {
  assert.equal(openingCashForDay([sale()], [event()], [expense()], [banking()], '2026-10-13'), 150)
})
test('pending banking must NOT reduce opening cash', () => {
  assert.equal(openingCashForDay([sale()], [], [], [banking({status:'pending'})], '2026-10-13'), 400)
})
test('banking before launch does not reduce cash', () => {
  assert.equal(openingCashForDay([sale()], [], [], [banking({banking_date:'2026-10-10'})], '2026-10-13'), 400)
})
test('next-day repayment adds to the following opening', () => {
  assert.equal(openingCashForDay([sale()], [event()], [], [], '2026-10-14'), 400)
})
