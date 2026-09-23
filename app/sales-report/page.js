'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

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
  events.forEach(e => {
    if (e.event_type === 'payment' && e.sale_id) payBySale[e.sale_id] = (payBySale[e.sale_id] || 0) + Number(e.amount)
  })
  const saleTimePaid = (s) => Math.max(0, Number(s.amount_paid) - (payBySale[s.id] || 0))

  const collectedOnDay = (day) => {
    const atSale = sales.filter(s => toDayStr(new Date(s.created_at)) === day).reduce((sum, s) => sum + saleTimePaid(s), 0)
    const later = events.filter(e => e.event_type === 'payment' && toDayStr(new Date(e.created_at)) === day).reduce((sum, e) => sum + Number(e.amount), 0)
    return atSale + later
  }
  const bankedOnDay = (day) => bankings.filter(b => b.banking_date === day).reduce((sum, b) => sum + Number(b.amount_banked), 0)

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      window.location.href = '/login'
      return
    }
    setUserId(session.user.id)
    const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
    setProfile(prof)
    const admin = prof?.role === 'admin' || prof?.role === 'super_admin'

    let q = supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(500)
    if (!admin) q = q.eq('sold_by', session.user.id)
    const { data: s } = await q
    setSales(s || [])

    const { data: ev } = await supabase.from('debt_events').select('*').order('created_at', { ascending: false }).limit(400)
    setEvents(ev || [])

    const { data: bk } = await supabase.from('bankings').select('*').limit(400)
    setBankings(bk || [])

    if (admin) {
      const { data: users } = await supabase.from('users').select('id, full_name')
      setUserMap(Object.fromEntries((users || []).map(u => [u.id, u])))
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const c = params.get('customer')
    const t = params.get('tab')
    if (c) {
      setTab('debtors')
      setSelectedCustomer(c)
    } else if (t) {
      setTab(t)
    }
  }, [])

  const now = new Date()
  const todayStr = toDayStr(now)
  const todaySales = sales.filter(s => toDayStr(new Date(s.created_at)) === todayStr)
  const todayRevenue = todaySales.reduce((sum, s) => sum + Number(s.total_amount), 0)
  const todayOwed = todaySales.reduce((sum, s) => sum + Math.max(0, balance(s)), 0)

  const salesByDay = {}
  sales.forEach(s => {
    const day = toDayStr(new Date(s.created_at))
    salesByDay[day] = salesByDay[day] || []
    salesByDay[day].push(s)
  })
  const saleDays = Object.keys(salesByDay).sort().reverse()

  const debtorMap = {}
  sales.forEach(s => {
    const bal = balance(s)
    if (bal > 0.009) {
      debtorMap[s.customer_name] = debtorMap[s.customer_name] || { name: s.customer_name, owed: 0, last: s.created_at }
      debtorMap[s.customer_name].owed += bal
      if (s.created_at > debtorMap[s.customer_name].last) debtorMap[s.customer_name].last = s.created_at
    }
  })
  const debtors = Object.values(debtorMap).sort((a, b) => b.owed - a.owed)

  const customerSales = selectedCustomer ? sales.filter(s => s.customer_name === selectedCustomer) : []
  const customerEvents = selectedCustomer ? events.filter(e => e.customer_name === selectedCustomer) : []
  const customerOwed = customerSales.reduce((sum, s) => sum + Math.max(0, balance(s)), 0)

  const recordPayment = async (e) => {
    e.preventDefault()
    let remaining = Number(payAmount)
    if (!remaining || remaining <= 0) return
    const open = customerSales.filter(s => balance(s) > 0.009).sort((a, b) => a.created_at.localeCompare(b.created_at))
    for (const s of open) {
      if (remaining <= 0) break
      const apply = Math.min(balance(s), remaining)
      await supabase.from('sales').update({ amount_paid: Number(s.amount_paid) + apply }).eq('id', s.id)
      await supabase.from('debt_events').insert({
        sale_id: s.id, customer_name: selectedCustomer, event_type: 'payment',
        amount: apply, received_by: userId, notes: payNotes || null
      })
      remaining -= apply
    }
    if (remaining > 0) {
      await supabase.from('debt_events').insert({
        sale_id: null, customer_name: selectedCustomer, event_type: 'payment',
        amount: remaining, received_by: userId, notes: (payNotes || '') + ' (overpayment/advance)'
      })
    }
    setMessage({ type: 'success', text: `Payment of ${Number(payAmount).toLocaleString()} UGX recorded against ${selectedCustomer}'s oldest debts.` })
    setPayAmount(''); setPayNotes('')
    load()
  }

  const recordReturn = async (e) => {
    e.preventDefault()
    const sale = customerSales.find(s => s.id === Number(retSaleId))
    if (!sale) return
    const value = Math.min(Number(retQty) * Number(sale.unit_price), balance(sale))
    await supabase.from('sales').update({ adjustments: (Number(sale.adjustments) || 0) + value }).eq('id', sale.id)
    await supabase.from('debt_events').insert({
      sale_id: sale.id, customer_name: selectedCustomer, event_type: 'return',
      amount: value, item_label: sale.item_label, quantity: Number(retQty), received_by: userId, notes: retNotes || null
    })
    setMessage({ type: 'success', text: `Return recorded: ${retQty} × ${sale.item_label} = ${value.toLocaleString()} UGX deducted from debt. Receiver: ${profile.full_name}.` })
    setRetSaleId(''); setRetQty(''); setRetNotes('')
    load()
  }

  const recordCompensation = async (e) => {
    e.preventDefault()
    const open = customerSales.filter(s => balance(s) > 0.009).sort((a, b) => a.created_at.localeCompare(b.created_at))
    const target = open[0] || null
    if (target) await supabase.from('sales').update({ adjustments: (Number(target.adjustments) || 0) + Number(compAmount) }).eq('id', target.id)
    await supabase.from('debt_events').insert({
      sale_id: target ? target.id : null, customer_name: selectedCustomer, event_type: 'compensation',
      amount: Number(compAmount), received_by: userId, notes: compNotes || null
    })
    setMessage({ type: 'success', text: `Compensation of ${Number(compAmount).toLocaleString()} UGX recorded and deducted. Receiver: ${profile.full_name}.` })
    setCompAmount(''); setCompNotes('')
    load()
  }

  if (!profile || loading) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">💳 Sales & Credit Book</h1>
          <p className="text-slate-400 text-sm">{isAdmin ? 'All sales, all debtors — the full credit department' : 'Your sales and your customers\' debts'}</p>
        </div>
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
      </header>

      {message && (
        <div className={`mb-4 max-w-3xl rounded-lg p-3 text-sm ${message.type === 'success' ? 'bg-green-900/50 text-green-200 border border-green-700' : 'bg-red-900/50 text-red-200 border border-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 max-w-3xl mb-6">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase">Sales today</p>
          <p className="text-lg font-black text-white mt-1">{todayRevenue.toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-green-500/40">
          <p className="text-xs text-slate-400 uppercase">Cash had today</p>
          <p className="text-lg font-black text-green-400 mt-1">{collectedOnDay(todayStr).toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-red-500/40">
          <p className="text-xs text-slate-400 uppercase">Owed from today</p>
          <p className="text-lg font-black text-red-400 mt-1">{todayOwed.toLocaleString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 bg-slate-800 p-1 rounded-lg mb-6 max-w-md">
        <button onClick={() => { setTab('sales'); setSelectedCustomer(null) }}
          className={`py-2 rounded-md text-sm font-bold ${tab === 'sales' ? 'bg-amber-500 text-slate-900' : 'text-slate-400'}`}>
          Sales Record
        </button>
        <button onClick={() => { setTab('debtors'); setSelectedCustomer(null) }}
          className={`py-2 rounded-md text-sm font-bold ${tab === 'debtors' ? 'bg-amber-500 text-slate-900' : 'text-slate-400'}`}>
          Debtors & Payments {debtors.length > 0 && <span className="text-red-400">({debtors.length})</span>}
        </button>
      </div>

      {tab === 'sales' && (
        <div className="max-w-3xl space-y-8">
          {saleDays.length === 0 && <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500">No sales yet.</div>}
          {saleDays.map(day => (
            <div key={day}>
              <h3 className="text-sm font-black text-amber-400 uppercase tracking-wide mb-2">
                {day === todayStr ? '📍 Today' : `📅 ${day}`}
              </h3>
              <div className="space-y-3">
                {salesByDay[day].map(s => (
                  <div key={s.id} className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                    <div className="flex items-start justify-between mb-2">
                      <p className="font-bold text-white">{s.item_label || 'Item'}</p>
                      <span className={`text-xs font-bold px-2 py-1 rounded uppercase ${s.payment_status === 'paid' ? 'bg-green-500/20 text-green-300' : s.payment_status === 'partial' ? 'bg-amber-500/20 text-amber-300' : 'bg-red-500/20 text-red-300'}`}>
                        {s.payment_status}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400">
                      {s.quantity} × {Number(s.unit_price).toLocaleString()} = <span className="text-white font-bold">{Number(s.total_amount).toLocaleString()} UGX</span>
                    </p>
                    <p className="text-sm text-slate-400 mt-1">
                      Customer: <span className="text-white font-semibold">{s.customer_name}</span>
                      {isAdmin && <> · Sold by: <span className="text-white font-semibold">{userMap[s.sold_by]?.full_name || '—'}</span></>}
                    </p>
                    <div className="flex gap-4 mt-2 text-sm">
                      <span className="text-green-400">Paid: {Number(s.amount_paid).toLocaleString()}</span>
                      {balance(s) > 0.009 && <span className="text-red-400 font-bold">Owes: {balance(s).toLocaleString()}</span>}
                      {(Number(s.adjustments) || 0) > 0 && <span className="text-blue-400">Returns/comp: {Number(s.adjustments).toLocaleString()}</span>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 mt-3 flex flex-wrap gap-6 text-sm">
                <span className="text-green-400 font-bold">💵 Cash had this day: {collectedOnDay(day).toLocaleString()}</span>
                <span className="text-white font-bold">🏦 Banked this day: {bankedOnDay(day).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'debtors' && !selectedCustomer && (
        <div className="max-w-3xl space-y-3">
          {debtors.length === 0 && <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500">🎉 Nobody owes anything.</div>}
          {debtors.map(d => (
            <button key={d.name} onClick={() => setSelectedCustomer(d.name)}
              className="w-full flex items-center justify-between bg-slate-800 hover:bg-slate-700 rounded-xl border border-red-500/30 p-4 text-left transition">
              <div>
                <p className="font-bold text-white text-base">{d.name}</p>
                <p className="text-xs text-slate-500 mt-1">Last purchase {new Date(d.last).toLocaleDateString()}</p>
              </div>
              <p className="text-xl font-black text-red-400">{d.owed.toLocaleString()}</p>
            </button>
          ))}
        </div>
      )}

      {tab === 'debtors' && selectedCustomer && (
        <div className="max-w-3xl space-y-6">
          <button onClick={() => setSelectedCustomer(null)}
            className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">
            ← All debtors
          </button>

          <div className="bg-slate-800 rounded-xl border-2 border-red-500/40 p-5">
            <p className="text-sm text-slate-400">Total owed by</p>
            <p className="text-2xl font-black text-white">{selectedCustomer}</p>
            <p className="text-3xl font-black text-red-400 mt-2">{customerOwed.toLocaleString()} UGX</p>
          </div>

          <section>
            <h3 className="text-sm font-black text-amber-400 uppercase mb-2">What they took (context of the debt)</h3>
            <div className="space-y-3">
              {customerSales.map(s => (
                <div key={s.id} className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                  <div className="flex justify-between">
                    <p className="font-bold text-white text-sm">{s.item_label || 'Item'} × {s.quantity}</p>
                    <p className="text-sm text-white font-bold">{Number(s.total_amount).toLocaleString()}</p>
                  </div>
                  <div className="flex gap-4 mt-2 text-sm">
                    <span className="text-slate-500">{new Date(s.created_at).toLocaleDateString()}</span>
                    <span className="text-green-400">paid {Number(s.amount_paid).toLocaleString()}</span>
                    {(Number(s.adjustments) || 0) > 0 && <span className="text-blue-400">returns {Number(s.adjustments).toLocaleString()}</span>}
                    <span className={`font-bold ${balance(s) > 0.009 ? 'text-red-400' : 'text-slate-500'}`}>
                      {balance(s) > 0.009 ? `demanded: ${balance(s).toLocaleString()}` : 'settled ✅'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-slate-800 rounded-xl border border-slate-700 p-5 space-y-5">
            <h3 className="text-sm font-black text-green-400 uppercase">💵 Record Payment</h3>
            <form onSubmit={recordPayment} className="flex flex-col md:flex-row gap-3">
              <input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} required
                className="flex-1 rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="Amount received (UGX)" />
              <input value={payNotes} onChange={(e) => setPayNotes(e.target.value)}
                className="flex-1 rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="e.g. MoMo, cash..." />
              <button type="submit" className="bg-green-500 hover:bg-green-400 text-slate-900 font-bold text-sm px-4 py-2 rounded-lg">+ Payment</button>
            </form>
            <p className="text-xs text-slate-500">Payments apply to the OLDEST debt first. Receiver recorded automatically: {profile.full_name}.</p>

            <h3 className="text-sm font-black text-blue-400 uppercase pt-2">📦 Record Returned Items</h3>
            <form onSubmit={recordReturn} className="space-y-3">
              <select value={retSaleId} onChange={(e) => setRetSaleId(e.target.value)} required
                className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm">
                <option value="">-- Which purchase are they returning from? --</option>
                {customerSales.filter(s => balance(s) > 0.009).map(s => (
                  <option key={s.id} value={s.id}>{s.item_label} × {s.quantity} @ {Number(s.unit_price).toLocaleString()} ({new Date(s.created_at).toLocaleDateString()})</option>
                ))}
              </select>
              <div className="flex gap-3">
                <input type="number" step="0.001" value={retQty} onChange={(e) => setRetQty(e.target.value)} required
                  className="flex-1 rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="Qty returned" />
                <input value={retNotes} onChange={(e) => setRetNotes(e.target.value)}
                  className="flex-1 rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="Condition/notes" />
                <button type="submit" className="bg-blue-500 hover:bg-blue-400 text-slate-900 font-bold text-sm px-4 py-2 rounded-lg">+ Return</button>
              </div>
            </form>

            <h3 className="text-sm font-black text-purple-400 uppercase pt-2">🤝 Record Compensation (in kind/value)</h3>
            <form onSubmit={recordCompensation} className="flex flex-col md:flex-row gap-3">
              <input type="number" step="0.01" value={compAmount} onChange={(e) => setCompAmount(e.target.value)} required
                className="flex-1 rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="Value agreed (UGX)" />
              <input value={compNotes} onChange={(e) => setCompNotes(e.target.value)}
                className="flex-1 rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="What was given instead?" />
              <button type="submit" className="bg-purple-500 hover:bg-purple-400 text-white font-bold text-sm px-4 py-2 rounded-lg">+ Compensate</button>
            </form>
          </section>

          <section>
            <h3 className="text-sm font-black text-amber-400 uppercase mb-2">Payment & return history</h3>
            <div className="space-y-2">
              {customerEvents.length === 0 && <p className="text-sm text-slate-500 text-center py-3">No payments or returns recorded yet.</p>}
              {customerEvents.map(ev => (
                <div key={ev.id} className={`rounded-lg p-3 text-sm border ${
                  ev.event_type === 'payment' ? 'border-green-500/40 bg-green-900/10'
                  : ev.event_type === 'return' ? 'border-blue-500/40 bg-blue-900/10'
                  : 'border-purple-500/40 bg-purple-900/10'}`}>
                  <div className="flex justify-between">
                    <p className="font-bold text-white uppercase text-xs">
                      {ev.event_type === 'payment' ? '💵 payment' : ev.event_type === 'return' ? '📦 return' : '🤝 compensation'}
                    </p>
                    <p className="font-black text-white">{Number(ev.amount).toLocaleString()}</p>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {ev.event_type === 'return' && `${ev.quantity} × ${ev.item_label} · `}
                    received by {isAdmin ? (userMap[ev.received_by]?.full_name || '—') : profile.full_name}
                    {ev.notes && ` · 📝 ${ev.notes}`} · {new Date(ev.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}