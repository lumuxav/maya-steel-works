'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SYSTEM_BRANCH, getSystemUserIds } from '../../lib/branch'

const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function SalesReportPage() {
  const [profile, setProfile] = useState(null)
  const [userId, setUserId] = useState(null)
  const [tab, setTab] = useState('sales')
  const [sales, setSales] = useState([])
  const [events, setEvents] = useState([])
  const [bankings, setBankings] = useState([])
  const [userMap, setUserMap] = useState({})
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [payAmount, setPayAmount] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [retSaleId, setRetSaleId] = useState('')
  const [retQty, setRetQty] = useState('')
  const [retNotes, setRetNotes] = useState('')
  const [compAmount, setCompAmount] = useState('')
  const [compNotes, setCompNotes] = useState('')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
  const balance = (s) => Number(s.total_amount) - Number(s.amount_paid) - (Number(s.adjustments) || 0)

  const payBySale = {}
  events.forEach(e => { if (e.event_type === 'payment' && e.sale_id) payBySale[e.sale_id] = (payBySale[e.sale_id] || 0) + Number(e.amount) })
  const saleTimePaid = (s) => Math.max(0, Number(s.amount_paid) - (payBySale[s.id] || 0))
  const collectedOnDay = (day) => sales.filter(s => toDayStr(new Date(s.created_at)) === day).reduce((sum, s) => sum + saleTimePaid(s), 0) + events.filter(e => e.event_type === 'payment' && toDayStr(new Date(e.created_at)) === day).reduce((sum, e) => sum + Number(e.amount), 0)
  const bankedOnDay = (day) => bankings.filter(b => b.banking_date === day).reduce((sum, b) => sum + Number(b.amount_banked), 0)

  const load = async () => {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return (window.location.href = '/login')
      setUserId(session.user.id)

      const [profileRes, systemUsers, salesRes, eventsRes, bankingRes, userRes] = await Promise.all([
        supabase.from('users').select('full_name, role, branch').eq('id', session.user.id).single(),
        getSystemUserIds(supabase),
        supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(1000),
        supabase.from('debt_events').select('*').order('created_at', { ascending: false }).limit(1000),
        supabase.from('bankings').select('*').limit(1000),
        supabase.from('users').select('id, full_name, branch')
      ])
      const errors = [profileRes, salesRes, eventsRes, bankingRes, userRes].map((result) => result.error).filter(Boolean)
      if (errors.length) throw new Error(errors[0].message)
      const prof = profileRes.data
      if (!prof) throw new Error('Maya staff profile was not found.')
      setProfile(prof)
      const admin = prof.role === 'admin' || prof.role === 'super_admin'
      const branchSales = (salesRes.data || []).filter((row) => systemUsers.has(row.sold_by))
      const visibleSales = admin ? branchSales : branchSales.filter((row) => row.sold_by === session.user.id)
      setSales(visibleSales)
      const branchSaleIds = new Set(branchSales.map((row) => row.id))
      setEvents((eventsRes.data || []).filter((row) =>
        (row.sale_id && branchSaleIds.has(row.sale_id)) || (!row.sale_id && systemUsers.has(row.received_by))))
      setBankings((bankingRes.data || []).filter((row) => systemUsers.has(row.recorded_by)))
      setUserMap(Object.fromEntries((userRes.data || []).filter((row) => systemUsers.has(row.id)).map((row) => [row.id, row])))
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Could not load Maya sales and credit records.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { const p = new URLSearchParams(window.location.search); const c = p.get('customer'), t = p.get('tab'); if (c) { setTab('debtors'); setSelectedCustomer(c) } else if (t) setTab(t) }, [])

  const now = new Date(), todayStr = toDayStr(now)
  const todaySales = sales.filter(s => toDayStr(new Date(s.created_at)) === todayStr)
  const todayRevenue = todaySales.reduce((sum, s) => sum + Number(s.total_amount), 0)
  const todayOwed = todaySales.reduce((sum, s) => sum + Math.max(0, balance(s)), 0)
  const salesByDay = {}; sales.forEach(s => { const day = toDayStr(new Date(s.created_at)); salesByDay[day] = salesByDay[day] || []; salesByDay[day].push(s) })
  const saleDays = Object.keys(salesByDay).sort().reverse()
  const debtorMap = {}; sales.forEach(s => { const bal = balance(s); if (bal > 0.009) { debtorMap[s.customer_name] = debtorMap[s.customer_name] || { name: s.customer_name, owed: 0, last: s.created_at }; debtorMap[s.customer_name].owed += bal; if (s.created_at > debtorMap[s.customer_name].last) debtorMap[s.customer_name].last = s.created_at } })
  const debtors = Object.values(debtorMap).sort((a,b) => b.owed - a.owed)
  const customerSales = selectedCustomer ? sales.filter(s => s.customer_name === selectedCustomer) : []
  const customerEvents = selectedCustomer ? events.filter(e => e.customer_name === selectedCustomer) : []
  const customerOwed = customerSales.reduce((sum, s) => sum + Math.max(0, balance(s)), 0)

  const recordPayment = async (e) => {
    e.preventDefault(); let remaining = Number(payAmount); if (!remaining || remaining <= 0) return
    const open = customerSales.filter(s => balance(s) > 0.009).sort((a,b) => a.created_at.localeCompare(b.created_at))
    for (const s of open) { if (remaining <= 0) break; const apply = Math.min(balance(s), remaining); await supabase.from('sales').update({ amount_paid: Number(s.amount_paid) + apply }).eq('id', s.id); await supabase.from('debt_events').insert({ sale_id: s.id, customer_name: selectedCustomer, event_type: 'payment', amount: apply, received_by: userId, notes: payNotes || null }); remaining -= apply }
    if (remaining > 0) await supabase.from('debt_events').insert({ sale_id: null, customer_name: selectedCustomer, event_type: 'payment', amount: remaining, received_by: userId, notes: (payNotes || '') + ' (overpayment/advance)' })
    setMessage({ type: 'success', text: `Payment of ${Number(payAmount).toLocaleString()} UGX recorded.` }); setPayAmount(''); setPayNotes(''); load()
  }

  const recordReturn = async (e) => {
    e.preventDefault(); const sale = customerSales.find(s => s.id === Number(retSaleId)); if (!sale) return
    const value = Math.min(Number(retQty) * Number(sale.unit_price), balance(sale))
    await supabase.from('sales').update({ adjustments: (Number(sale.adjustments) || 0) + value }).eq('id', sale.id)
    await supabase.from('debt_events').insert({ sale_id: sale.id, customer_name: selectedCustomer, event_type: 'return', amount: value, item_label: sale.item_label, quantity: Number(retQty), received_by: userId, notes: retNotes || null })
    setMessage({ type: 'success', text: `Return adjustment of ${value.toLocaleString()} UGX recorded.` }); setRetSaleId(''); setRetQty(''); setRetNotes(''); load()
  }

  const recordCompensation = async (e) => {
    e.preventDefault(); const open = customerSales.filter(s => balance(s) > 0.009).sort((a,b) => a.created_at.localeCompare(b.created_at)); const target = open[0] || null
    if (target) await supabase.from('sales').update({ adjustments: (Number(target.adjustments) || 0) + Number(compAmount) }).eq('id', target.id)
    await supabase.from('debt_events').insert({ sale_id: target ? target.id : null, customer_name: selectedCustomer, event_type: 'compensation', amount: Number(compAmount), received_by: userId, notes: compNotes || null })
    setMessage({ type: 'success', text: `Compensation of ${Number(compAmount).toLocaleString()} UGX recorded.` }); setCompAmount(''); setCompNotes(''); load()
  }

  if (!profile || loading) return <main className="page-wrap text-muted">Loading sales report...</main>

  return <main className="page-wrap">
    <div className="page-header-row"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Sales & Credit Book</h1><p className="page-subtitle">Sales, debtors and payments for Maya Branch only.</p></div></div>
    {message && <div className={`mb-4 max-w-3xl rounded-xl border p-3 text-sm ${message.type === 'success' ? 'border-green-500/30 bg-green-500/10 text-green-500' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}>{message.text}</div>}
    <div className="mb-6 grid max-w-3xl grid-cols-3 gap-3"><div className="page-card p-4"><p className="text-xs text-muted">Sales today</p><p className="mt-1 text-lg font-black">{todayRevenue.toLocaleString()}</p></div><div className="page-card p-4"><p className="text-xs text-muted">Cash had today</p><p className="mt-1 text-lg font-black text-green-500">{collectedOnDay(todayStr).toLocaleString()}</p></div><div className="page-card p-4"><p className="text-xs text-muted">Owed from today</p><p className="mt-1 text-lg font-black text-red-500">{todayOwed.toLocaleString()}</p></div></div>
    <div className="mb-6 grid max-w-md grid-cols-2 gap-2 rounded-xl bg-[var(--panel)] p-1"><button onClick={() => { setTab('sales'); setSelectedCustomer(null) }} className={`rounded-lg py-2 text-sm font-bold ${tab === 'sales' ? 'bg-amber-500 text-slate-950' : 'text-muted'}`}>Sales Record</button><button onClick={() => { setTab('debtors'); setSelectedCustomer(null) }} className={`rounded-lg py-2 text-sm font-bold ${tab === 'debtors' ? 'bg-amber-500 text-slate-950' : 'text-muted'}`}>Debtors {debtors.length ? `(${debtors.length})` : ''}</button></div>

    {tab === 'sales' && <div className="max-w-3xl space-y-8">{saleDays.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No Maya Branch sales yet.</div>}{saleDays.map(day => <div key={day}><h3 className="mb-2 text-sm font-black text-amber-500">{day === todayStr ? 'Today' : day}</h3><div className="space-y-3">{salesByDay[day].map(s => <div key={s.id} className="page-card p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{s.item_label || 'Item'}</p><p className="mt-1 text-sm text-muted">{s.quantity} × {Number(s.unit_price).toLocaleString()} = <strong>{Number(s.total_amount).toLocaleString()} UGX</strong></p><p className="mt-1 text-sm text-muted">{s.customer_name}{isAdmin ? ` · ${userMap[s.sold_by]?.full_name || '—'}` : ''}</p></div><span className={`rounded-lg px-2 py-1 text-xs font-black uppercase ${s.payment_status === 'paid' ? 'bg-green-500/10 text-green-500' : s.payment_status === 'partial' ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500'}`}>{s.payment_status}</span></div><div className="mt-2 flex gap-4 text-sm"><span className="text-green-500">Paid {Number(s.amount_paid).toLocaleString()}</span>{balance(s) > 0.009 && <span className="font-bold text-red-500">Owes {balance(s).toLocaleString()}</span>}</div></div>)}</div><div className="mt-3 flex flex-wrap gap-6 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><span className="font-bold text-green-500">Cash had: {collectedOnDay(day).toLocaleString()}</span><span className="font-bold">Banked: {bankedOnDay(day).toLocaleString()}</span></div></div>)}</div>}

    {tab === 'debtors' && !selectedCustomer && <div className="max-w-3xl space-y-3">{debtors.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">Nobody owes anything.</div>}{debtors.map(d => <button key={d.name} onClick={() => setSelectedCustomer(d.name)} className="page-card flex w-full items-center justify-between p-4 text-left"><div><p className="font-black">{d.name}</p><p className="mt-1 text-xs text-muted">Last purchase {new Date(d.last).toLocaleDateString()}</p></div><p className="text-xl font-black text-red-500">{d.owed.toLocaleString()}</p></button>)}</div>}

    {tab === 'debtors' && selectedCustomer && <div className="max-w-3xl space-y-5"><button onClick={() => setSelectedCustomer(null)} className="text-sm font-bold text-amber-500">← All debtors</button><div className="page-card p-5"><div className="flex items-center justify-between"><div><h2 className="text-xl font-black">{selectedCustomer}</h2><p className="text-sm text-muted">Maya Branch account</p></div><p className="text-2xl font-black text-red-500">{customerOwed.toLocaleString()} UGX</p></div></div>
      <form onSubmit={recordPayment} className="page-card space-y-3 p-5"><h3 className="font-black">Record payment</h3><input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} required className="input-base" placeholder="Amount received" /><input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} className="input-base" placeholder="Notes" /><button className="w-full rounded-xl bg-green-500 py-3 font-black text-slate-950">Apply to oldest debt</button></form>
      <form onSubmit={recordReturn} className="page-card space-y-3 p-5"><h3 className="font-black">Return / credit adjustment</h3><select value={retSaleId} onChange={(e) => setRetSaleId(e.target.value)} required className="input-base"><option value="">Choose sale</option>{customerSales.filter(s => balance(s) > 0.009).map(s => <option key={s.id} value={s.id}>{s.item_label} · owes {balance(s).toLocaleString()}</option>)}</select><input type="number" step="0.001" value={retQty} onChange={(e) => setRetQty(e.target.value)} required className="input-base" placeholder="Quantity returned" /><input value={retNotes} onChange={(e) => setRetNotes(e.target.value)} className="input-base" placeholder="Notes" /><button className="w-full rounded-xl bg-amber-500 py-3 font-black text-slate-950">Record return</button></form>
      <form onSubmit={recordCompensation} className="page-card space-y-3 p-5"><h3 className="font-black">Compensation / discount</h3><input type="number" step="0.01" value={compAmount} onChange={(e) => setCompAmount(e.target.value)} required className="input-base" placeholder="Amount" /><input value={compNotes} onChange={(e) => setCompNotes(e.target.value)} className="input-base" placeholder="Reason" /><button className="w-full rounded-xl bg-amber-500 py-3 font-black text-slate-950">Apply compensation</button></form>
      <div className="page-card p-5"><h3 className="font-black">Account activity</h3><div className="mt-3 space-y-2">{customerEvents.length === 0 && <p className="text-sm text-muted">No payment events yet.</p>}{customerEvents.map(e => <div key={e.id} className="rounded-xl bg-[var(--panel-2)] p-3"><p className="font-bold capitalize">{e.event_type} · {Number(e.amount).toLocaleString()} UGX</p><p className="mt-1 text-xs text-muted">{new Date(e.created_at).toLocaleString()} {e.notes ? `· ${e.notes}` : ''}</p></div>)}</div></div>
    </div>}
  </main>
}
