export const MAYA_LAUNCH_DAY = '2026-10-12'
export const MAYA_TIME_ZONE = 'Africa/Kampala'

const calendar = new Intl.DateTimeFormat('en-GB', {
  timeZone: MAYA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
})

export function mayaBusinessDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid Maya business timestamp')
  const pieces = Object.fromEntries(calendar.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]))
  return `${pieces.year}-${pieces.month}-${pieces.day}`
}

export function addBusinessDays(day, offset) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(offset)) throw new RangeError('Invalid Maya business date')
  const result = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(result.getTime())) throw new RangeError('Invalid Maya business date')
  result.setUTCDate(result.getUTCDate() + offset)
  return result.toISOString().slice(0, 10)
}

export function businessArchiveDays(startDay, throughDay) {
  if (startDay > throughDay) return []
  const days = []
  let day = throughDay
  while (day >= startDay && days.length < 36525) {
    days.push(day)
    day = addBusinessDays(day, -1)
  }
  return days
}

export function amount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

export function saleCashAtTransaction(sale, events) {
  const laterPayments = events.filter((event) => event.event_type === 'payment' && event.sale_id != null && String(event.sale_id) === String(sale.id))
    .reduce((sum, event) => sum + amount(event.amount), 0)
  return Math.max(0, amount(sale.amount_paid) - laterPayments)
}

export function outstandingBalance(sale) {
  return Math.max(0, amount(sale.total_amount) - amount(sale.amount_paid) - amount(sale.adjustments))
}

export function receivedOnDay(sales, events, day) {
  const transactions = sales.filter((sale) => mayaBusinessDay(sale.created_at) === day)
    .reduce((sum, sale) => sum + saleCashAtTransaction(sale, events), 0)
  const repayments = events.filter((event) => event.event_type === 'payment' && mayaBusinessDay(event.created_at) === day)
    .reduce((sum, event) => sum + amount(event.amount), 0)
  return transactions + repayments
}

export function closingCash(opening, received, expenses, confirmedBankings) {
  return Math.max(0, amount(opening) + amount(received) - amount(expenses) - amount(confirmedBankings))
}

export function openingCashForDay(sales, events, expenses, bankings, day, startDay = MAYA_LAUNCH_DAY) {
  const cashIn = sales.filter((sale) => mayaBusinessDay(sale.created_at) >= startDay && mayaBusinessDay(sale.created_at) < day)
    .reduce((sum, sale) => sum + saleCashAtTransaction(sale, events), 0)
    + events.filter((event) => event.event_type === 'payment' && mayaBusinessDay(event.created_at) >= startDay && mayaBusinessDay(event.created_at) < day)
      .reduce((sum, event) => sum + amount(event.amount), 0)
  const spent = expenses.filter((exp) => mayaBusinessDay(exp.created_at) >= startDay && mayaBusinessDay(exp.created_at) < day)
    .reduce((sum, exp) => sum + amount(exp.amount), 0)
  const confirmed = bankings.filter((bank) => bank.status === 'confirmed' && bank.banking_date >= startDay && bank.banking_date < day)
    .reduce((sum, bank) => sum + amount(bank.amount_banked), 0)
  return closingCash(0, cashIn, spent, confirmed)
}
