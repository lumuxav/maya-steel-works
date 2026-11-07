import { MAYA_LAUNCH_DAY, MAYA_TIME_ZONE, mayaBusinessDay, addBusinessDays } from './mayaBusiness.mjs'

const sum = (rows, field) => rows.reduce((total, row) => total + money(row[field]), 0)
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100
const keyOf = (sale) => `${sale.item_type}-${sale.item_id}`
// A custom job's lines end in " (job #12)"; report lists add up by name, so that ending is left off.
const plainLabel = (label) => String(label ?? '').replace(/ \(job #\d+\)$/, '')
const adjustment = (event) => ['return', 'compensation'].includes(event.event_type)

function money(value) {
  if (value == null || value === '') return 0
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error('A financial record contains an invalid amount. Correct it before reporting.')
  return n
}

export function validatePeriod(from, to) {
  for (const day of [from, to]) {
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError('Choose both a valid start date and end date.')
    addBusinessDays(day, 0)
  }
  if (from > to) throw new RangeError('The start date must be on or before the end date.')
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 36600) throw new RangeError('Choose a period of no more than 100 years.')
  return { from, to }
}

export function periodPreset(preset, today = mayaBusinessDay()) {
  const end = today < MAYA_LAUNCH_DAY ? MAYA_LAUNCH_DAY : today
  const first = `${end.slice(0, 7)}-01`
  let from = end, to = end
  if (preset === '7d') from = addBusinessDays(end, -6)
  if (preset === 'month') from = first
  if (preset === 'last-month') { to = addBusinessDays(first, -1); from = `${to.slice(0, 7)}-01` }
  if (preset === 'all') from = MAYA_LAUNCH_DAY
  return { from, to }
}

// These are estimates from recorded batch costs, not immutable sale-time COGS.
// Missing cost data stays unknown; it must never inflate profit by becoming zero.
export function estimateUnitCosts(raws, movements, runs) {
  const rawCosts = new Map(), units = new Map(), costs = new Map(), missing = new Set()
  const received = new Map()
  for (const m of movements) if (m.item_type === 'raw' && ['received', 'transfer_in'].includes(m.movement_type)) {
    received.set(String(m.item_id), (received.get(String(m.item_id)) || 0) + money(m.quantity_change))
  }
  for (const raw of raws) {
    const qty = received.get(String(raw.id)) || 0
    if (raw.total_landed_cost != null && qty > 0) rawCosts.set(String(raw.id), money(raw.total_landed_cost) / qty)
  }
  for (const run of runs) {
    const id = String(run.finished_good_id), unit = rawCosts.get(String(run.raw_material_id))
    const used = money(run.raw_units_used), yieldQty = money(run.actual_yield)
    if (unit == null || used <= 0 || yieldQty <= 0) { missing.add(id); continue }
    costs.set(id, (costs.get(id) || 0) + used * unit)
    units.set(id, (units.get(id) || 0) + yieldQty)
  }
  const result = Object.fromEntries([...rawCosts].map(([id, value]) => [`raw-${id}`, value]))
  for (const [id, cost] of costs) if (!missing.has(id)) result[`finished-${id}`] = cost / units.get(id)
  return result
}

export function buildPeriodReport({ from, to, sales = [], events = [], expenses = [], bankings = [], unitCosts = {}, costsAvailable = true, now = new Date() }) {
  validatePeriod(from, to)
  const today = mayaBusinessDay(now), through = to < today ? to : today
  const start = from > MAYA_LAUNCH_DAY ? from : MAYA_LAUNCH_DAY
  const notes = []
  if (from < MAYA_LAUNCH_DAY) notes.push(`Operating history starts on ${MAYA_LAUNCH_DAY}. Earlier stored records are retained and excluded from this report.`)
  if (to > today) notes.push(`The end date is in the future. Actual activity is included only through ${today}.`)
  if (through === today) notes.push('Today is still in progress; refresh for the latest transactions.')
  const inPeriod = (day) => day >= start && day <= through
  const operating = (day) => day >= MAYA_LAUNCH_DAY && day <= through
  const saleById = new Map(sales.map((s) => [String(s.id), s]))
  const paid = new Map(), adjusted = new Map(), paidThrough = new Map(), adjustedThrough = new Map()
  const dayMap = new Map()
  const dayRow = (day) => {
    if (!dayMap.has(day)) dayMap.set(day, { day, sales: 0, adjustments: 0, cashReceived: 0, expenses: 0, banked: 0, pendingBanking: 0, saleCount: 0 })
    return dayMap.get(day)
  }
  for (const e of events) {
    const id = String(e.sale_id), day = mayaBusinessDay(e.created_at), value = money(e.amount)
    if (e.sale_id != null && e.event_type === 'payment') {
      paid.set(id, (paid.get(id) || 0) + value)
      if (day <= through) paidThrough.set(id, (paidThrough.get(id) || 0) + value)
    }
    if (e.sale_id != null && adjustment(e)) {
      adjusted.set(id, (adjusted.get(id) || 0) + value)
      if (day <= through) adjustedThrough.set(id, (adjustedThrough.get(id) || 0) + value)
    }
    if (operating(day)) {
      if (e.event_type === 'payment') dayRow(day).cashReceived += value
      // An adjustment of an excluded pre-launch invoice is not a production sale reduction.
      const original = saleById.get(id)
      if (adjustment(e) && original && mayaBusinessDay(original.created_at) >= MAYA_LAUNCH_DAY) dayRow(day).adjustments += value
    }
  }
  let stockSales = 0, serviceSales = 0, initialCash = 0, outstanding = 0, cogs = 0, missingCosts = 0
  let untrackedAdjustments = 0, saleCount = 0
  const topMap = new Map()
  for (const s of sales) {
    const id = String(s.id), day = mayaBusinessDay(s.created_at)
    const immediate = money(s.amount_paid) - (paid.get(id) || 0)
    if (immediate < -0.01) throw new Error('Payments changed while loading or need reconciliation. Refresh the report.')
    if (operating(day)) {
      dayRow(day).cashReceived += Math.max(0, immediate)
      dayRow(day).sales += money(s.total_amount)
      dayRow(day).saleCount += 1
    }
    if (!inPeriod(day)) continue
    const value = money(s.total_amount)
    saleCount += 1
    if (s.item_type === 'service') serviceSales += value
    else stockSales += value
    initialCash += Math.max(0, immediate)
    const legacyAdjustment = Math.max(0, money(s.adjustments) - (adjusted.get(id) || 0))
    if (legacyAdjustment > 0.01) untrackedAdjustments += 1
    outstanding += Math.max(0, value - Math.max(0, immediate) - (paidThrough.get(id) || 0) - (adjustedThrough.get(id) || 0) - legacyAdjustment)
    if (s.item_type !== 'service') {
      const unit = unitCosts[keyOf(s)]
      if (!Number.isFinite(unit)) missingCosts += 1
      else cogs += money(s.quantity) * unit
    }
    const key = s.item_type === 'service' ? `service-${plainLabel(s.item_label) || 'Customer material'}` : keyOf(s)
    const entry = topMap.get(key) || { label: plainLabel(s.item_label) || `${s.item_type} item #${s.item_id}`, quantity: 0, sales: 0 }
    entry.quantity += money(s.quantity); entry.sales += value; topMap.set(key, entry)
  }
  const categories = new Map()
  for (const e of expenses) {
    const day = mayaBusinessDay(e.created_at)
    if (operating(day)) dayRow(day).expenses += money(e.amount)
    if (inPeriod(day)) categories.set(e.category || 'Other', (categories.get(e.category || 'Other') || 0) + money(e.amount))
  }
  for (const b of bankings) if (operating(b.banking_date)) {
    if (b.status === 'confirmed') dayRow(b.banking_date).banked += money(b.amount_banked)
    if (b.status === 'pending') dayRow(b.banking_date).pendingBanking += money(b.amount_banked)
  }
  // Existing return entries reduce debt but do not restore stock. Do not invent a cost reversal.
  const periodEvents = events.filter((e) => inPeriod(mayaBusinessDay(e.created_at)))
  const repayments = sum(periodEvents.filter((e) => e.event_type === 'payment' && e.sale_id != null), 'amount')
  const advances = sum(periodEvents.filter((e) => e.event_type === 'payment' && e.sale_id == null), 'amount')
  let openingCash = 0, closingCash = 0
  const daily = []
  if (start <= through) {
    for (const [day, row] of dayMap) if (day < start) openingCash += row.cashReceived - row.expenses - row.banked
    closingCash = openingCash
    for (let day = start; day <= through; day = addBusinessDays(day, 1)) {
      const row = dayRow(day), open = closingCash
      closingCash += row.cashReceived - row.expenses - row.banked
      daily.push({ ...row, openingCash: open, closingCash, netSales: row.sales - row.adjustments })
    }
  }
  const grossSales = stockSales + serviceSales, adjustments = sum(daily, 'adjustments')
  const netSales = grossSales - adjustments, expenseTotal = sum(daily, 'expenses'), cashReceived = sum(daily, 'cashReceived')
  const estimateAvailable = costsAvailable && missingCosts === 0
  if (!estimateAvailable) notes.push('Profit estimate is unavailable because stock cost information is incomplete. Sales and cash totals remain available.')
  if (untrackedAdjustments) notes.push('Some invoices have adjustments without dated events. Historical outstanding credit is unavailable until those records are reconciled.')
  if (daily.some((d) => d.closingCash < -0.01)) notes.push('The ledger shows a cash deficit on one or more days. Reconcile expenses and confirmed banking; negative balances have not been hidden.')
  const totals = {
    grossSales, stockSales, serviceSales, adjustments, netSales, cashReceived, initialCash, repayments, advances,
    expenses: expenseTotal, banked: sum(daily, 'banked'), pendingBanking: sum(daily, 'pendingBanking'),
    openingCash, closingCash, netCashFlow: cashReceived - expenseTotal,
    outstanding: untrackedAdjustments ? null : outstanding,
    estimatedCostOfGoods: estimateAvailable ? cogs : null,
    estimatedGrossProfit: estimateAvailable ? netSales - cogs : null,
    estimatedNetProfit: estimateAvailable ? netSales - cogs - expenseTotal : null,
  }
  return {
    from, to, effectiveFrom: start, effectiveTo: through, launchDay: MAYA_LAUNCH_DAY,
    timeZone: MAYA_TIME_ZONE, generatedAt: new Date(now).toISOString(), saleCount, operatingDays: daily.length,
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v === null ? null : round(v)])),
    daily: daily.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]))),
    expenseCategories: [...categories].map(([category, total]) => ({ category, total: round(total) })).sort((a, b) => b.total - a.total),
    topItems: [...topMap.values()].sort((a, b) => b.sales - a.sales).slice(0, 10), notes,
  }
}

export function periodReportCsv(report) {
  const cell = (value) => {
    let text = String(value ?? '')
    if (typeof value === 'string' && (/^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text
    return `"${text.replace(/"/g, '""')}"`
  }
  const rows = [['Maya Steel Works period report'], ['Requested start', report.from], ['Requested end (inclusive)', report.to], ['Time zone', report.timeZone], ['Currency', 'UGX'], ['Generated at', report.generatedAt], [], ['Summary', 'UGX']]
  for (const [key, value] of Object.entries(report.totals)) rows.push([key, value ?? 'Unavailable'])
  rows.push([], ['Day', 'Opening cash', 'Gross sales', 'Adjustments', 'Net sales', 'Cash received', 'Expenses', 'Confirmed banking', 'Pending banking', 'Closing cash', 'Sales count'])
  for (const d of report.daily) rows.push([d.day, d.openingCash, d.sales, d.adjustments, d.netSales, d.cashReceived, d.expenses, d.banked, d.pendingBanking, d.closingCash, d.saleCount])
  rows.push([], ['Expense category', 'UGX'], ...report.expenseCategories.map((c) => [c.category, c.total]))
  rows.push([], ['Item / service', 'Quantity', 'Gross sales UGX'], ...report.topItems.map((i) => [i.label, i.quantity, i.sales]))
  rows.push([], ['Profit is an estimate from current recorded batch costs; stock costs are not frozen at sale time.'], ['Banking is a cash transfer, not an expense. Pending banking is not deducted.'], ...report.notes.map((n) => [n]))
  return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n')
}
