'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

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
      if (!session) {
        window.location.href = '/login'
        return
      }
      const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
      setProfile(prof)
      if (!(prof?.role === 'admin' || prof?.role === 'super_admin')) {
        setLoading(false)
        return
      }

      const { data: s } = await supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(500)
      setSales(s || [])
      const { data: e } = await supabase.from('expenses').select('*').limit(500)
      setExpenses(e || [])

      const { data: raws } = await supabase.from('raw_materials_admin_view').select('id, category, gauge, size_dimensions, quantity, total_landed_cost')
      const { data: ins } = await supabase.from('stock_movements')
        .select('item_id, quantity_change')
        .eq('item_type', 'raw')
        .in('movement_type', ['received', 'transfer_in'])
      const initial = {}
      ;(ins || []).forEach(m => { initial[m.item_id] = (initial[m.item_id] || 0) + Number(m.quantity_change) })

      const ruc = {}
      const labels = {}
      let rawVal = 0
      ;(raws || []).forEach(r => {
        const init = initial[r.id] || Number(r.quantity) || 1
        const uc = init > 0 ? Number(r.total_landed_cost) / init : 0
        ruc[r.id] = uc
        rawVal += uc * Number(r.quantity)
        labels['raw-' + r.id] = `${r.category} ${r.gauge || ''} ${r.size_dimensions || ''}`
      })
      setRawUnitCost(ruc)

      const { data: runs } = await supabase.from('production_log').select('finished_good_id, raw_material_id, raw_units_used, actual_yield')
      const costByFg = {}
      const qtyByFg = {}
      ;(runs || []).forEach(run => {
        const c = (Number(run.raw_units_used) || 0) * (ruc[run.raw_material_id] || 0)
        costByFg[run.finished_good_id] = (costByFg[run.finished_good_id] || 0) + c
        qtyByFg[run.finished_good_id] = (qtyByFg[run.finished_good_id] || 0) + (Number(run.actual_yield) || 0)
      })
      const fuc = {}
      Object.keys(costByFg).forEach(k => { fuc[k] = qtyByFg[k] > 0 ? costByFg[k] / qtyByFg[k] : 0 })
      setFgUnitCost(fuc)

      const { data: fgs } = await supabase.from('finished_goods').select('id, name, gauge, size_dimensions, quantity')
      let fgVal = 0
      ;(fgs || []).forEach(f => {
        fgVal += (fuc[f.id] || 0) * Number(f.quantity)
        labels['finished-' + f.id] = `${f.name} ${f.gauge || ''} ${f.size_dimensions || ''}`
      })
      setStockValue({ raw: rawVal, fg: fgVal })
      setLabelMap(labels)

      setLoading(false)
    }
    load()
  }, [])

  const periodStart = () => {
    const now = new Date()
    if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    if (period === '7d') return new Date(now.getTime() - 7 * 86400000).toISOString()
    if (period === '30d') return new Date(now.getTime() - 30 * 86400000).toISOString()
    if (period === 'custom' && fromDate) return new Date(fromDate + 'T00:00:00').toISOString()
    return null
  }

  const periodEnd = () => {
    if (period === 'custom' && toDate) return new Date(toDate + 'T23:59:59').toISOString()
    return null
  }

  const start = periodStart()
  const end = periodEnd()
  const inPeriod = (t) => (!start || t >= start) && (!end || t <= end)
  const pSales = sales.filter(s => inPeriod(s.created_at))
  const pExp = expenses.filter(e => inPeriod(e.created_at))

  const revenue = pSales.reduce((s, x) => s + Number(x.total_amount), 0)
  const cogs = pSales.reduce((s, x) => {
    if (x.item_type === 'service') return s
    const uc = x.item_type === 'raw' ? (rawUnitCost[x.item_id] || 0) : (fgUnitCost[x.item_id] || 0)
    return s + Number(x.quantity) * uc
  }, 0)
  const gross = revenue - cogs
  const expTotal = pExp.reduce((s, x) => s + Number(x.amount), 0)
  const net = gross - expTotal
  const collected = pSales.reduce((s, x) => s + Number(x.amount_paid), 0)
  const owed = pSales.reduce((s, x) => s + Math.max(0, Number(x.total_amount) - Number(x.amount_paid)), 0)

  const byItem = {}
  pSales.forEach(s => {
    const key = s.item_type === 'service' ? `service-${s.item_label || 'Customer Material'}` : `${s.item_type}-${s.item_id}`
    byItem[key] = byItem[key] || { qty: 0, revenue: 0, label: s.item_type === 'service' ? (s.item_label || 'Customer Material Service') : null }
    byItem[key].qty += Number(s.quantity)
    byItem[key].revenue += Number(s.total_amount)
  })
  const top = Object.entries(byItem).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8)

  if (!profile) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
    return (
      <main className="min-h-screen bg-slate-900 p-6">
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back to Dashboard</Link>
        <div className="bg-slate-800 rounded-xl p-6 max-w-md mt-8">
          <p className="text-white font-bold">🔒 Boss eyes only</p>
          <p className="text-slate-400 text-sm mt-2">Profit, costs and margins are visible only to Admin and Super Admin.</p>
        </div>
      </main>
    )
  }

  if (loading) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">📈 Profit Dashboard</h1>
          <p className="text-slate-400 text-sm">Revenue − cost of goods − expenses = your true profit</p>
        </div>
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back to Dashboard</Link>
      </header>

      <div className="flex flex-wrap gap-2 mb-4">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={`px-4 py-2 rounded-lg text-sm font-bold border ${period === p.key ? 'bg-amber-500 border-amber-500 text-slate-900' : 'border-slate-600 text-slate-300 hover:bg-slate-800'}`}>
            {p.label}
          </button>
        ))}
      </div>

      {period === 'custom' && (
        <div className="flex flex-wrap gap-3 mb-6 bg-slate-800 rounded-xl p-4 max-w-md border border-slate-700">
          <div className="flex-1">
            <label className="block text-[10px] text-slate-400 uppercase mb-1">From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] text-slate-400 uppercase mb-1">To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 max-w-6xl mb-4">
        <div className="bg-slate-800 rounded-xl p-4 border border-green-500/40">
          <p className="text-xs text-slate-400 uppercase">Revenue</p>
          <p className="text-xl font-black text-green-400 mt-1">{revenue.toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-red-500/40">
          <p className="text-xs text-slate-400 uppercase">Cost of goods (est.)</p>
          <p className="text-xl font-black text-red-400 mt-1">{Math.round(cogs).toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase">Gross profit</p>
          <p className={`text-xl font-black mt-1 ${gross >= 0 ? 'text-white' : 'text-red-400'}`}>{Math.round(gross).toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-red-500/40">
          <p className="text-xs text-slate-400 uppercase">Expenses</p>
          <p className="text-xl font-black text-red-400 mt-1">{expTotal.toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border-2 border-amber-500">
          <p className="text-xs text-slate-400 uppercase">NET PROFIT</p>
          <p className={`text-xl font-black mt-1 ${net >= 0 ? 'text-amber-400' : 'text-red-400'}`}>{Math.round(net).toLocaleString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-6xl mb-10">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase">Cash collected</p>
          <p className="text-lg font-black text-green-400 mt-1">{collected.toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-red-500/40">
          <p className="text-xs text-slate-400 uppercase">Still owed to you</p>
          <p className="text-lg font-black text-red-400 mt-1">{owed.toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase">Stock value at cost (raw)</p>
          <p className="text-lg font-black text-white mt-1">{Math.round(stockValue.raw).toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase">Stock value at cost (finished)</p>
          <p className="text-lg font-black text-white mt-1">{Math.round(stockValue.fg).toLocaleString()}</p>
        </div>
      </div>

      <h2 className="text-lg font-bold text-white mb-3">Top sellers & services this period</h2>
      <div className="overflow-x-auto bg-slate-800 rounded-xl max-w-4xl">
        <table className="w-full text-sm text-left text-slate-300">
          <thead className="bg-slate-700/50 text-slate-200 uppercase text-xs">
            <tr>
              <th className="px-4 py-3">Item / Service</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {top.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500">No sales or services in this period.</td></tr>
            )}
            {top.map(([key, v]) => (
              <tr key={key} className="border-t border-slate-700">
                <td className="px-4 py-3 font-semibold text-white">{v.label || labelMap[key] || key}</td>
                <td className="px-4 py-3">{v.qty}</td>
                <td className="px-4 py-3 font-bold text-green-400">{v.revenue.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-500 mt-6 max-w-4xl">
        * Stock sales use estimated material cost. Customer-material service jobs have no Maya material COGS because the customer supplies the metal; labour and machine overhead remain part of business expenses.
      </p>
    </main>
  )
}