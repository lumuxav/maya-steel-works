// Custom job: the customer picks stock, we cut / press / make it on the spot.
//
// The database does the real work (supabase/migrations/20261107_maya_custom_job.sql, called as
// maya_ledger('custom_job', ...)). This file holds the pieces that are plain logic, so they can be
// tested without a browser or a database:
//   * buildCustomJobPayload - checks the form the same way the database does (so mistakes are
//     caught before the request is sent) and shapes the request;
//   * groupSalesByJob       - the sales lines of one job (metal lines + the labour line) share a
//     "(job #N)" ending in their label; this puts them back together for display;
//   * stripJobSuffix        - the label without that ending, for reports that add things up by name.

export const MAX_JOB_MATERIALS = 8
export const JOB_DESCRIPTION_MIN = 3
export const JOB_DESCRIPTION_MAX = 200
export const LABOUR_PREFIX = 'Labour - '

const JOB_SUFFIX = / \(job #(\d+)\)$/

const toNumber = (value) => (value === '' || value === null || value === undefined ? NaN : Number(value))
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const hasAtMost3Decimals = (n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-7

export function stripJobSuffix(label) {
  return String(label ?? '').replace(JOB_SUFFIX, '')
}

// { base, jobId } - jobId is null when the label does not belong to a custom job.
export function parseJobLabel(label) {
  const text = String(label ?? '')
  const match = text.match(JOB_SUFFIX)
  if (!match) return { base: text, jobId: null }
  return { base: text.slice(0, match.index), jobId: Number(match[1]) }
}

// A sales row written by a custom job: a stock line or the labour line, with the job ending.
export function isJobLine(sale) {
  if (!sale) return false
  const { jobId } = parseJobLabel(sale.item_label)
  if (jobId === null) return false
  if (sale.item_type === 'raw') return true
  return sale.item_type === 'service' && String(sale.item_label).startsWith(LABOUR_PREFIX)
}

export function jobTotals(materials, labour) {
  const lines = (materials || []).map((m) => {
    const units = toNumber(m.raw_units)
    const price = toNumber(m.unit_price)
    return Number.isFinite(units) && Number.isFinite(price) && units > 0 && price > 0 ? round2(units * price) : 0
  })
  const material = round2(lines.reduce((sum, v) => sum + v, 0))
  const labourAmount = Number.isFinite(toNumber(labour)) && toNumber(labour) > 0 ? round2(toNumber(labour)) : 0
  return { lines, material, labour: labourAmount, total: round2(material + labourAmount) }
}

// Checks a custom job form and returns the request for maya_ledger('custom_job').
// Throws RangeError with a message for the person at the counter.
//   input.materials: [{ raw_id, raw_units, unit_price }]   (raw_units / unit_price may be strings)
//   input.available: optional { [raw_id]: quantity on the shelf }, to stop an obvious over-draw
//   input.units:     optional { [raw_id]: 'sheets' }, only used in messages
export function buildCustomJobPayload(input) {
  const description = String(input?.description ?? '').trim()
  if (description.length < JOB_DESCRIPTION_MIN) throw new RangeError('Describe the job, for example "Ribbed plate, half sheet".')
  if (description.length > JOB_DESCRIPTION_MAX) throw new RangeError(`Keep the job description under ${JOB_DESCRIPTION_MAX} characters.`)

  const status = input?.status
  if (!['paid', 'partial', 'credit'].includes(status)) throw new RangeError('Choose Paid, Partial or Credit.')

  const list = Array.isArray(input?.materials) ? input.materials : []
  if (list.length < 1) throw new RangeError('Choose the stock used in the job.')
  if (list.length > MAX_JOB_MATERIALS) throw new RangeError(`A job can use at most ${MAX_JOB_MATERIALS} stock items.`)

  const materials = list.map((line, index) => {
    const n = index + 1
    const rawId = toNumber(line?.raw_id)
    if (!Number.isInteger(rawId) || rawId <= 0) throw new RangeError(`Stock line ${n}: choose the stock item.`)
    const units = toNumber(line?.raw_units)
    if (!Number.isFinite(units) || units <= 0) throw new RangeError(`Stock line ${n}: enter how much was used (for example 0.5).`)
    if (!hasAtMost3Decimals(units)) throw new RangeError(`Stock line ${n}: use at most 3 decimal places.`)
    const price = toNumber(line?.unit_price)
    if (!Number.isFinite(price) || price <= 0) throw new RangeError(`Stock line ${n}: enter the price of one whole unit.`)
    return { raw_id: rawId, raw_units: units, unit_price: price }
  })

  // the same item may be picked on two lines; what matters is the total taken off the shelf
  if (input?.available) {
    const used = new Map()
    for (const m of materials) used.set(m.raw_id, round3((used.get(m.raw_id) || 0) + m.raw_units))
    for (const [rawId, total] of used) {
      const have = Number(input.available[rawId])
      if (Number.isFinite(have) && total > have + 1e-9) {
        const unit = input.units?.[rawId] ? ` ${input.units[rawId]}` : ''
        throw new RangeError(`Only ${have}${unit} of that stock is available at Maya Branch, but the job uses ${total}.`)
      }
    }
  }

  const labourRaw = input?.labour
  const labour = labourRaw === '' || labourRaw === null || labourRaw === undefined ? 0 : toNumber(labourRaw)
  if (!Number.isFinite(labour) || labour < 0) throw new RangeError('The labour charge must be zero or more.')

  const customer = String(input?.customer ?? '').trim()
  if (status !== 'paid' && !customer) throw new RangeError('Enter the customer name for a credit or part-payment job.')

  const totals = jobTotals(materials, labour)
  const payload = { description, materials, labour_amount: labour, payment_status: status }
  if (customer) payload.customer_name = customer
  if (status === 'partial') {
    const paid = toNumber(input?.paidAmount)
    if (!Number.isFinite(paid) || paid <= 0 || paid >= totals.total) {
      throw new RangeError('The part payment must be more than 0 and less than the job total.')
    }
    payload.amount_paid = paid
  }
  return { payload, totals }
}

const round3 = (n) => Math.round(n * 1000) / 1000

// Today's sales list: puts the lines of each job into one entry, keeps ordinary sales as they are.
// Input order (newest first) is kept; a job sits where its newest line was.
export function groupSalesByJob(sales) {
  const entries = []
  const jobs = new Map()
  for (const sale of sales || []) {
    if (!isJobLine(sale)) {
      entries.push({ kind: 'sale', key: `sale-${sale.id}`, sale })
      continue
    }
    const { jobId } = parseJobLabel(sale.item_label)
    const key = `job-${jobId}-${sale.customer_name ?? ''}`
    let job = jobs.get(key)
    if (!job) {
      job = { kind: 'job', key, jobId, customer: sale.customer_name, createdAt: sale.created_at, materials: [], labour: null, rows: [] }
      jobs.set(key, job)
      entries.push(job)
    }
    job.rows.push(sale)
    if (sale.item_type === 'service') job.labour = sale
    else job.materials.push(sale)
  }
  for (const job of jobs.values()) {
    job.materials.sort((a, b) => Number(a.id) - Number(b.id))
    job.total = round2(job.rows.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0))
    job.paid = round2(job.rows.reduce((sum, r) => sum + (Number(r.amount_paid) || 0), 0))
    job.status = job.paid >= job.total ? 'paid' : job.paid <= 0 ? 'credit' : 'partial'
    job.description = job.labour ? parseJobLabel(job.labour.item_label).base.slice(LABOUR_PREFIX.length) : ''
  }
  return entries
}
