import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

async function verifySuperAdmin(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '')
  if (!token) return { error: 'No session token sent.' }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return { error: 'Session expired.' }

  const { data: caller } = await supabase.from('users').select('role, active').eq('id', data.user.id).single()
  if (caller?.role !== 'super_admin' || caller?.active === false) return { error: 'Super Admin only.' }

  return { supabase }
}

const safeRows = async (promise) => {
  try {
    const result = await promise
    return { data: result.data || [], error: result.error?.message || null }
  } catch (error) {
    return { data: [], error: error?.message || 'Query failed' }
  }
}

export async function GET(req) {
  const check = await verifySuperAdmin(req)
  if (check.error) return NextResponse.json({ error: check.error }, { status: 403 })

  const { supabase } = check
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

  const [usersR, salesR, expensesR, bankingsR, runsR, countsR, correctionsR, rawR, finishedR, authR] = await Promise.all([
    safeRows(supabase.from('users').select('id, full_name, role, active, created_at, branch')),
    safeRows(supabase.from('sales').select('id, item_type, item_id, quantity, total_amount, amount_paid, sold_by, created_at').order('created_at', { ascending: false }).limit(500)),
    safeRows(supabase.from('expenses').select('id, amount, recorded_by, created_at').order('created_at', { ascending: false }).limit(500)),
    safeRows(supabase.from('bankings').select('*').order('created_at', { ascending: false }).limit(500)),
    safeRows(supabase.from('production_log').select('*').order('created_at', { ascending: false }).limit(500)),
    safeRows(supabase.from('stocktakes').select('*').order('count_date', { ascending: false }).limit(500)),
    safeRows(supabase.from('corrections_log').select('*').order('changed_at', { ascending: false }).limit(200)),
    safeRows(supabase.from('raw_materials_admin_view').select('id, quantity, current_branch')),
    safeRows(supabase.from('finished_goods').select('id, quantity, current_branch')),
    safeRows(supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }))
  ])

  const users = usersR.data
  const mayaUsers = users.filter((u) => !u.branch || u.branch === 'Maya Branch')
  const mayaUserIds = new Set(mayaUsers.map((u) => u.id))
  const rawIds = new Set(rawR.data.filter((x) => !x.current_branch || x.current_branch === 'Maya Branch').map((x) => String(x.id)))
  const finishedIds = new Set(finishedR.data.filter((x) => !x.current_branch || x.current_branch === 'Maya Branch').map((x) => String(x.id)))

  const sales = salesR.data.filter((x) => mayaUserIds.has(x.sold_by))
  const expenses = expensesR.data.filter((x) => mayaUserIds.has(x.recorded_by))
  const bankings = bankingsR.data.filter((x) => mayaUserIds.has(x.recorded_by))
  const runs = runsR.data.filter((x) => rawIds.has(String(x.raw_material_id)) || finishedIds.has(String(x.finished_good_id)))
  const counts = countsR.data.filter((x) => x.item_type === 'raw' ? rawIds.has(String(x.item_id)) : finishedIds.has(String(x.item_id)))
  const corrections = correctionsR.data.filter((x) => !x.changed_by || mayaUserIds.has(x.changed_by))

  const todaySales = sales.filter((x) => x.created_at >= dayStart)
  const todayExpenses = expenses.filter((x) => x.created_at >= dayStart)
  const todayCorrections = corrections.filter((x) => x.changed_at >= dayStart)
  const pendingBankings = bankings.filter((x) => x.status === 'pending')
  const flaggedBankings = bankings.filter((x) => x.flagged && x.status === 'pending')
  const productionFlags = runs.filter((x) => Number(x.actual_yield) !== Number(x.boss_expected_yield))
  const stockFlags = counts.filter((x) => Number(x.difference) !== 0)
  const negativeRaw = rawR.data.filter((x) => (!x.current_branch || x.current_branch === 'Maya Branch') && Number(x.quantity) < 0)
  const negativeFinished = finishedR.data.filter((x) => (!x.current_branch || x.current_branch === 'Maya Branch') && Number(x.quantity) < 0)
  const orphanSales = sales.filter((x) => {
    if (x.item_type === 'service') return false
    if (x.item_type === 'raw') return !rawIds.has(String(x.item_id))
    if (x.item_type === 'finished') return !finishedIds.has(String(x.item_id))
    return false
  })

  const authUsers = authR.data?.users || authR.data || []
  const authMap = Object.fromEntries(authUsers.map((u) => [u.id, u]))
  const usersWithAuth = mayaUsers.map((u) => ({
    ...u,
    email: authMap[u.id]?.email || null,
    last_sign_in_at: authMap[u.id]?.last_sign_in_at || null,
    auth_created_at: authMap[u.id]?.created_at || null,
  }))

  const recentActivity = [
    ...todaySales.map((x) => ({ type: 'sale', time: x.created_at, text: `Sale recorded · ${Number(x.total_amount).toLocaleString()} UGX` })),
    ...todayExpenses.map((x) => ({ type: 'expense', time: x.created_at, text: `Expense recorded · ${Number(x.amount).toLocaleString()} UGX` })),
    ...todayCorrections.map((x) => ({ type: 'correction', time: x.changed_at, text: `${x.table_name} #${x.row_id} changed · ${x.field_name}` })),
    ...bankings.filter((x) => x.created_at >= dayStart).map((x) => ({ type: 'banking', time: x.created_at, text: `Banking ${x.status} · ${Number(x.amount_banked).toLocaleString()} UGX` })),
    ...runs.filter((x) => x.created_at >= dayStart).map((x) => ({ type: 'production', time: x.created_at, text: `Production run · ${x.actual_yield} pieces` })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 30)

  const queryErrors = [usersR, salesR, expensesR, bankingsR, runsR, countsR, correctionsR, rawR, finishedR, authR]
    .map((x) => x.error)
    .filter(Boolean)

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    users: usersWithAuth,
    summary: {
      active_users: mayaUsers.filter((x) => x.active !== false).length,
      disabled_users: mayaUsers.filter((x) => x.active === false).length,
      actions_today: todaySales.length + todayExpenses.length + todayCorrections.length + bankings.filter((x) => x.created_at >= dayStart).length + runs.filter((x) => x.created_at >= dayStart).length,
      pending_bankings: pendingBankings.length,
      flagged_bankings: flaggedBankings.length,
      production_flags: productionFlags.length,
      stock_flags: stockFlags.length,
      corrections_today: todayCorrections.length,
      negative_stock: negativeRaw.length + negativeFinished.length,
      orphan_sales: orphanSales.length,
      query_errors: queryErrors.length,
    },
    integrity: {
      negative_stock: negativeRaw.length + negativeFinished.length,
      orphan_sales: orphanSales.length,
      flagged_bankings: flaggedBankings.length,
      production_flags: productionFlags.length,
      stocktake_differences: stockFlags.length,
      query_errors: queryErrors,
    },
    recent_activity: recentActivity,
  })
}
