'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SYSTEM_BRANCH, getSystemUserIds, isSystemBranch } from '../../lib/branch'

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'custom', label: 'Custom range' },
  { key: 'all', label: 'All time' }
]

export default function ProfitPage() {
  const [profile, setProfile] = useState(null)
  const [period, setPeriod] = useState('30d')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [sales, setSales] = useState([])
  const [expenses, setExpenses] = useState([])
  const [rawUnitCost, setRawUnitCost] = useState({})
  const [fgUnitCost, setFgUnitCost] = useState({})
  const [stockValue, setStockValue] = useState({ raw: 0, fg: 0 })
  const [labelMap, setLabelMap] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return (window.location.href = '/login')
      const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
      setProfile(prof)
      if (!(prof?.role === 'admin' || prof?.role === 'super_admin')) { setLoading(false); return }

      const systemUsers = await getSystemUserIds(supabase)
      const { data: s } = await supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(1000)
      setSales((s || []).filter(x => systemUsers.has(x.sold_by)))
      const { data: e } = await supabase.from('expenses').select('*').limit(1000)
      setExpenses((e || []).filter(x => systemUsers.has(x.recorded_by)))

      const { data: raws } = await supabase.from('raw_materials_admin_view').select('id, category, gauge, size_dimensions, quantity, total_landed_cost, current_branch')
      const mayaRaws = (raws || []).filter(r => isSystemBranch(r.current_branch))
      const rawIds = new Set(mayaRaws.map(r => r.id))
      const { data: ins } = await supabase.from('stock_movements').select('item_id, quantity_change').eq('item_type', 'raw').in('movement_type', ['received', 'transfer_in'])
      const initial = {}; (ins || []).filter(m => rawIds.has(m.item_id)).forEach(m => { initial[m.item_id] = (initial[m.item_id] || 0) + Number(m.quantity_change) })
      const ruc = {}, labels = {}; let rawVal = 0
      mayaRaws.forEach(r => { const init = initial[r.id] || Number(r.quantity) || 1; const uc = init > 0 ? Number(r.total_landed_cost) / init : 0; ruc[r.id] = uc; rawVal += uc * Number(r.quantity); labels['raw-' + r.id] = `${r.category} ${r.gauge || ''} ${r.size_dimensions || ''}` })
      setRawUnitCost(ruc)

      const { data: runs } = await supabase.from('production_log').select('finished_good_id, raw_material_id, raw_units_used, actual_yield')
      const costByFg = {}, qtyByFg = {}
      ;(runs || []).filter(run => rawIds.has(run.raw_material_id)).forEach(run => { const c = (Number(run.raw_units_used) || 0) * (ruc[run.raw_material_id] || 0); costByFg[run.finished_good_id] = (costByFg[run.finished_good_id] || 0) + c; qtyByFg[run.finished_good_id] = (qtyByFg[run.finished_good_id] || 0) + (Number(run.actual_yield) || 0) })
      const fuc = {}; Object.keys(costByFg).forEach(k => { fuc[k] = qtyByFg[k] > 0 ? costByFg[k] / qtyByFg[k] : 0 })
      setFgUnitCost(fuc)

      const { data: fgs } = await supabase.from('finished_goods').select('id, name, gauge, size_dimensions, quantity, current_branch')
      let fgVal = 0
      ;(fgs || []).filter(f => isSystemBranch(f.current_branch)).forEach(f => { fgVal += (fuc[f.id] || 0) * Number(f.quantity); labels['finished-' + f.id] = `${f.name} ${f.gauge || ''} ${f.size_dimensions || ''}` })
      setStockValue({ raw: rawVal, fg: fgVal }); setLabelMap(labels); setLoading(false)
    }
    load()
  }, [])

  const periodStart = () => { const now = new Date(); if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(); if (period === '7d') return new Date(now.getTime() - 7*86400000).toISOString(); if (period === '30d') return new Date(now.getTime() - 30*86400000).toISOString(); if (period === 'custom' && fromDate) return new Date(fromDate + 'T00:00:00').toISOString(); return null }
  const periodEnd = () => period === 'custom' && toDate ? new Date(toDate + 'T23:59:59').toISOString() : null
  const start = periodStart(), end = periodEnd(), inPeriod = (t) => (!start || t >= start) && (!end || t <= end)
  const pSales = sales.filter(s => inPeriod(s.created_at)), pExp = expenses.filter(e => inPeriod(e.created_at))
  const revenue = pSales.reduce((s,x) => s + Number(x.total_amount), 0)
  const cogs = pSales.reduce((s,x) => { if (x.item_type === 'service') return s; const uc = x.item_type === 'raw' ? (rawUnitCost[x.item_id] || 0) : (fgUnitCost[x.item_id] || 0); return s + Number(x.quantity) * uc }, 0)
  const gross = revenue - cogs, expTotal = pExp.reduce((s,x) => s + Number(x.amount), 0), net = gross - expTotal
  const collected = pSales.reduce((s,x) => s + Number(x.amount_paid), 0), owed = pSales.reduce((s,x) => s + Math.max(0, Number(x.total_amount) - Number(x.amount_paid)), 0)
  const byItem = {}; pSales.forEach(s => { const key = s.item_type === 'service' ? `service-${s.item_label || 'Customer Material'}` : `${s.item_type}-${s.item_id}`; byItem[key] = byItem[key] || { qty: 0, revenue: 0, label: s.item_type === 'service' ? (s.item_label || 'Customer Material Service') : null }; byItem[key].qty += Number(s.quantity); byItem[key].revenue += Number(s.total_amount) })
  const top = Object.entries(byItem).sort((a,b) => b[1].revenue - a[1].revenue).slice(0,8)

  if (!profile || loading) return <main className="page-wrap text-muted">Loading profit...</main>
  if (profile.role !== 'admin' && profile.role !== 'super_admin') return <main className="page-wrap"><div className="page-card max-w-md p-6"><p className="font-black">Management only</p></div></main>

  return <main className="page-wrap"><div className="page-header-row"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Profit Dashboard</h1><p className="page-subtitle">Revenue, stock cost and expenses for Maya Branch only.</p></div></div>
    <div className="mb-4 flex flex-wrap gap-2">{PERIODS.map(p => <button key={p.key} onClick={() => setPeriod(p.key)} className={`rounded-xl border px-4 py-2 text-sm font-bold ${period === p.key ? 'border-amber-500 bg-amber-500 text-slate-950' : 'border-[var(--line)] text-muted'}`}>{p.label}</button>)}</div>
    {period === 'custom' && <div className="mb-6 flex max-w-md gap-3"><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="input-base" /><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="input-base" /></div>}
    <div className="mb-4 grid max-w-6xl grid-cols-2 gap-4 md:grid-cols-5"><div className="page-card p-4"><p className="text-xs text-muted">Revenue</p><p className="mt-1 text-xl font-black text-green-500">{revenue.toLocaleString()}</p></div><div className="page-card p-4"><p className="text-xs text-muted">Cost of goods</p><p className="mt-1 text-xl font-black text-red-500">{Math.round(cogs).toLocaleString()}</p></div><div className="page-card p-4"><p className="text-xs text-muted">Gross profit</p><p className="mt-1 text-xl font-black">{Math.round(gross).toLocaleString()}</p></div><div className="page-card p-4"><p className="text-xs text-muted">Expenses</p><p className="mt-1 text-xl font-black text-red-500">{expTotal.toLocaleString()}</p></div><div className="page-card border-amber-500/30 p-4"><p className="text-xs text-muted">Net profit</p><p className="mt-1 text-xl font-black text-amber-500">{Math.round(net).toLocaleString()}</p></div></div>
    <div className="mb-10 grid max-w-6xl grid-cols-2 gap-4 md:grid-cols-4"><div className="page-card p-4"><p className="text-xs text-muted">Cash collected</p><p className="mt-1 text-lg font-black text-green-500">{collected.toLocaleString()}</p></div><div className="page-card p-4"><p className="text-xs text-muted">Still owed</p><p className="mt-1 text-lg font-black text-red-500">{owed.toLocaleString()}</p></div><div className="page-card p-4"><p className="text-xs text-muted">Raw stock value</p><p className="mt-1 text-lg font-black">{Math.round(stockValue.raw).toLocaleString()}</p></div><div className="page-card p-4"><p className="text-xs text-muted">Finished stock value</p><p className="mt-1 text-lg font-black">{Math.round(stockValue.fg).toLocaleString()}</p></div></div>
    <h2 className="mb-3 text-lg font-black">Top sellers & services</h2><div className="page-card max-w-4xl overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead><tr className="border-b border-[var(--line)]"><th className="p-4">Item / Service</th><th className="p-4">Qty</th><th className="p-4">Revenue</th></tr></thead><tbody>{top.length === 0 && <tr><td colSpan={3} className="p-6 text-center text-muted">No Maya Branch sales in this period.</td></tr>}{top.map(([key,v]) => <tr key={key} className="border-b border-[var(--line)] last:border-0"><td className="p-4 font-bold">{v.label || labelMap[key] || key}</td><td className="p-4">{v.qty}</td><td className="p-4 font-black text-green-500">{v.revenue.toLocaleString()}</td></tr>)}</tbody></table></div>
  </main>
}
