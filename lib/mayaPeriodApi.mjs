import { readAllRows } from './mayaReportData.mjs'
import { buildPeriodReport, estimateUnitCosts, validatePeriod } from './mayaPeriodReport.mjs'

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' }
const response = (body, status = 200) => Response.json(body, { status, headers })
const mayaBranch = (branch) => branch == null || branch === 'Maya Branch'

export async function handlePeriodReport(req, { createClient, env = process.env, now = () => new Date() }) {
  const token = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return response({ error: 'Sign in to view financial reports.' }, 401)
  const url = env.NEXT_PUBLIC_SUPABASE_URL, anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return response({ error: 'Maya authentication is not configured.' }, 503)
  const database = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  try {
    const { data: auth, error: authError } = await database.auth.getUser(token)
    if (authError || !auth?.user) return response({ error: 'Your session has expired. Sign in again.' }, 401)
    const { data: profile, error: profileError } = await database.from('users')
      .select('role, active, branch').eq('id', auth.user.id).single()
    if (profileError) return response({ error: 'Staff permissions could not be verified. Please retry.' }, 503)
    if (!profile || profile.active !== true || !mayaBranch(profile.branch) || !['admin', 'super_admin'].includes(profile.role)) {
      return response({ error: 'Financial period reports are available to active Maya management only.' }, 403)
    }
    const params = new URL(req.url).searchParams
    const from = params.get('from'), to = params.get('to')
    try { validatePeriod(from, to) } catch (error) { return response({ error: error.message }, 400) }
    const startedAt = now()
    const countTables = ['sales', 'debt_events', 'expenses', 'bankings', 'corrections_log']
    const counts = async () => Promise.all(countTables.map(async (table) => {
      const { count, error } = await database.from(table).select('id', { count: 'exact', head: true })
      if (error || !Number.isSafeInteger(count)) throw new Error('Financial record counts are unavailable.')
      return count
    }))
    const before = await counts()
    const all = (table, columns = '*') => readAllRows(() => database.from(table).select(columns, { count: 'exact' }))
    const [users, sales, events, expenses, bankings] = await Promise.all([
      all('users', 'id, branch'), all('sales'), all('debt_events'), all('expenses'), all('bankings'),
    ])
    const usersInBranch = new Set(users.filter((u) => mayaBranch(u.branch)).map((u) => u.id))
    const branchSales = sales.filter((s) => usersInBranch.has(s.sold_by))
    const saleIds = new Set(branchSales.map((s) => String(s.id)))
    let unitCosts = {}, costsAvailable = true
    try {
      const [raws, movements, runs] = await Promise.all([
        all('raw_materials_admin_view', 'id, total_landed_cost, current_branch'),
        all('stock_movements', 'id, item_id, item_type, movement_type, quantity_change'),
        all('production_log', 'id, finished_good_id, raw_material_id, raw_units_used, actual_yield'),
      ])
      unitCosts = estimateUnitCosts(raws.filter((r) => mayaBranch(r.current_branch)), movements, runs)
    } catch { costsAvailable = false }
    const after = await counts()
    const core = [sales, events, expenses, bankings]
    for (let index = 0; index < countTables.length; index += 1) {
      if (before[index] !== after[index] || (core[index] && core[index].length !== after[index])) {
        throw new Error('Records changed while loading. Refresh the report.')
      }
    }
    const report = buildPeriodReport({ from, to, now: startedAt, unitCosts, costsAvailable,
      sales: branchSales,
      events: events.filter((e) => e.sale_id != null ? saleIds.has(String(e.sale_id)) : usersInBranch.has(e.received_by)),
      expenses: expenses.filter((e) => usersInBranch.has(e.recorded_by)),
      bankings: bankings.filter((b) => usersInBranch.has(b.recorded_by)),
    })
    return response({ ok: true, report })
  } catch (error) {
    return response({ error: error?.message?.startsWith('Records changed') || error?.message?.startsWith('Payments changed')
      ? error.message : 'The complete report could not be prepared. Please refresh; no partial totals have been shown.' }, 503)
  }
}
