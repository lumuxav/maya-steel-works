'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { SYSTEM_BRANCH, getSystemUserIds } from '../../lib/branch'

const TOLERANCE = 1
const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function CashbookPage() {
  const todayStr = toDayStr(new Date())
  const [profile, setProfile] = useState(null)
  const [userId, setUserId] = useState(null)
  const [entryMode, setEntryMode] = useState(false)
  const [selectedDay, setSelectedDay] = useState(todayStr)
  const [systemStartDay, setSystemStartDay] = useState(todayStr)
  const [sales, setSales] = useState([])
  const [expenses, setExpenses] = useState([])
  const [bankings, setBankings] = useState([])
  const [events, setEvents] = useState([])
  const [categories, setCategories] = useState([])
  const [userMap, setUserMap] = useState({})
  const [expDesc, setExpDesc] = useState('')
  const [expCat, setExpCat] = useState('Other')
  const [expAmount, setExpAmount] = useState('')
  const [newCat, setNewCat] = useState('')
  const [bankDate, setBankDate] = useState(todayStr)
  const [bankAmount, setBankAmount] = useState('')
  const [bankMethod, setBankMethod] = useState('')
  const [bankNotes, setBankNotes] = useState('')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
  const isSuper = profile?.role === 'super_admin'
  const canEnter = !isAdmin || entryMode

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return (window.location.href = '/login')
    setUserId(session.user.id)
    const { data: prof } = await supabase.from('users').select('full_name, role, branch').eq('id', session.user.id).single()
    setProfile(prof)

    const systemUsers = await getSystemUserIds(supabase)
    const { data: users } = await supabase.from('users').select('id, full_name, branch, created_at')
    const systemProfiles = (users || []).filter(u => systemUsers.has(u.id))
    setUserMap(Object.fromEntries(systemProfiles.map(u => [u.id, u])))
    const createdDays = systemProfiles.map(u => u.created_at).filter(Boolean).map(value => toDayStr(new Date(value))).sort()
    if (createdDays.length) setSystemStartDay(createdDays[0])

    const { data: s } = await supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(1000)
    const branchSales = (s || []).filter(x => systemUsers.has(x.sold_by))
    setSales((prof?.role === 'admin' || prof?.role === 'super_admin') ? branchSales : branchSales.filter(x => x.sold_by === session.user.id))
    const branchSaleIds = new Set(branchSales.map(x => x.id))

    const { data: exps } = await supabase.from('expenses').select('*').order('created_at', { ascending: false }).limit(1000)
    setExpenses((exps || []).filter(x => systemUsers.has(x.recorded_by)))

    const { data: banks } = await supabase.from('bankings').select('*').order('created_at', { ascending: false }).limit(1000)
    setBankings((banks || []).filter(x => systemUsers.has(x.recorded_by)))

    const { data: ev } = await supabase.from('debt_events').select('*').order('created_at', { ascending: false }).limit(1000)
    setEvents((ev || []).filter(x => (x.sale_id && branchSaleIds.has(x.sale_id)) || (!x.sale_id && systemUsers.has(x.received_by))))

    const { data: cats } = await supabase.from('expense_categories').select('*').order('name')
    setCategories(cats || [])
    if ((cats || []).length && !(cats || []).some(c => c.name === expCat)) setExpCat(cats[0].name)
    setLoading(false)
  }

  useEffect(() => { load() }, [])
  useEffect(() => { const d = new URLSearchParams(window.location.search).get('day'); if (d) { setSelectedDay(d); setBankDate(d) } }, [])

  const payBySale = useMemo(() => {
    const map = {}
    events.forEach(e => { if (e.event_type === 'payment' && e.sale_id) map[e.sale_id] = (map[e.sale_id] || 0) + Number(e.amount) })
    return map
  }, [events])

  const saleTimePaid = (s) => Math.max(0, Number(s.amount_paid) - (payBySale[s.id] || 0))
  const collectedOnDay = (day) => {
    const atSale = sales.filter(s => toDayStr(new Date(s.created_at)) === day).reduce((sum, s) => sum + saleTimePaid(s), 0)
    const later = events.filter(e => e.event_type === 'payment' && toDayStr(new Date(e.created_at)) === day).reduce((sum, e) => sum + Number(e.amount), 0)
    return atSale + later
  }
  const inDay = (t, day) => toDayStr(new Date(t)) === day
  const visibleExpenses = expenses.filter(e => isAdmin || e.recorded_by === userId)

  const openingCashForDay = (day) => {
    const priorCash = sales.filter(s => toDayStr(new Date(s.created_at)) < day).reduce((sum, s) => sum + saleTimePaid(s), 0)
      + events.filter(e => e.event_type === 'payment' && toDayStr(new Date(e.created_at)) < day).reduce((sum, e) => sum + Number(e.amount), 0)
    const priorExpenses = visibleExpenses.filter(e => toDayStr(new Date(e.created_at)) < day).reduce((sum, e) => sum + Number(e.amount), 0)
    const priorBanked = bankings.filter(b => b.banking_date < day).reduce((sum, b) => sum + Number(b.amount_banked), 0)
    return Math.max(0, priorCash - priorExpenses - priorBanked)
  }

  const dayExpenses = visibleExpenses.filter(e => inDay(e.created_at, selectedDay))
  const dayBankings = bankings.filter(b => b.banking_date === selectedDay)
  const openingCash = openingCashForDay(selectedDay)
  const cashIn = collectedOnDay(selectedDay)
  const expTotal = dayExpenses.reduce((s, x) => s + Number(x.amount), 0)
  const bankedConfirmed = dayBankings.filter(b => b.status === 'confirmed').reduce((s, b) => s + Number(b.amount_banked), 0)
  const bankedPending = dayBankings.filter(b => b.status === 'pending').reduce((s, b) => s + Number(b.amount_banked), 0)
  const expectedNow = Math.max(0, openingCash + cashIn - expTotal - bankedConfirmed - bankedPending)
  const bankVariance = bankAmount !== '' ? Number(bankAmount) - expectedNow : null
  const willFlag = bankVariance !== null && Math.abs(bankVariance) >= TOLERANCE
  const flaggedPending = bankings.filter(b => b.flagged && b.status === 'pending')

  const archiveDays = []
  const [startY, startM, startD] = systemStartDay.split('-').map(Number)
  const [endY, endM, endD] = todayStr.split('-').map(Number)
  const cursor = new Date(startY, startM - 1, startD)
  const endDate = new Date(endY, endM - 1, endD)
  while (cursor <= endDate) {
    archiveDays.push(toDayStr(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  archiveDays.reverse()

  const daySummary = (day) => {
    const open = openingCashForDay(day)
    const cIn = collectedOnDay(day)
    const eT = visibleExpenses.filter(e => inDay(e.created_at, day)).reduce((s, x) => s + Number(x.amount), 0)
    const bT = bankings.filter(b => b.banking_date === day).reduce((s, b) => s + Number(b.amount_banked), 0)
    const closing = Math.max(0, open + cIn - eT - bT)
    const flags = bankings.filter(b => b.banking_date === day && b.flagged).length
    return { open, cIn, eT, bT, closing, flags }
  }

  const shiftDay = (delta) => {
    const [y, m, d] = selectedDay.split('-').map(Number)
    const nd = toDayStr(new Date(y, m - 1, d + delta))
    setSelectedDay(nd)
    setBankDate(nd)
  }

  const addCategory = async () => {
    if (!newCat.trim()) return
    const { error } = await supabase.from('expense_categories').insert({ name: newCat.trim(), created_by: userId })
    if (error) setMessage({ type: 'error', text: error.message }); else { setNewCat(''); load() }
  }
  const deleteCategory = async (id) => {
    if (!window.confirm('Remove this expense category?')) return
    const { error } = await supabase.from('expense_categories').delete().eq('id', id)
    if (error) setMessage({ type: 'error', text: error.message }); else load()
  }
  const addExpense = async (e) => {
    e.preventDefault()
    const { error } = await supabase.from('expenses').insert({ description: expDesc, category: expCat, amount: Number(expAmount), recorded_by: userId })
    if (error) setMessage({ type: 'error', text: error.message }); else { setMessage({ type: 'success', text: 'Expense recorded for Maya Branch.' }); setExpDesc(''); setExpAmount(''); load() }
  }
  const addBanking = async (e) => {
    e.preventDefault()
    const amt = Number(bankAmount)
    const variance = amt - expectedNow
    const flagged = Math.abs(variance) >= TOLERANCE
    const { error } = await supabase.from('bankings').insert({ banking_date: bankDate || selectedDay, amount_banked: amt, bank_or_method: bankMethod || null, notes: bankNotes || null, recorded_by: userId, status: 'pending', expected_amount: expectedNow, variance, flagged })
    if (error) setMessage({ type: 'error', text: error.message })
    else { setMessage(flagged ? { type: 'warn', text: `Banking saved and flagged. Difference: ${variance.toLocaleString()} UGX.` } : { type: 'success', text: 'Banking recorded and awaiting confirmation.' }); setBankAmount(''); setBankMethod(''); setBankNotes(''); load() }
  }
  const confirmBanking = async (b) => {
    if (!window.confirm(`Confirm ${Number(b.amount_banked).toLocaleString()} UGX banked on ${b.banking_date}?`)) return
    const { error } = await supabase.from('bankings').update({ status: 'confirmed', confirmed_by: userId, confirmed_at: new Date().toISOString() }).eq('id', b.id)
    if (error) setMessage({ type: 'error', text: error.message }); else { setMessage({ type: 'success', text: 'Banking confirmed.' }); load() }
  }

  if (!profile || loading) return <main className="page-wrap text-muted">Loading cash book...</main>

  return (
    <main className="page-wrap">
      <div className="page-header-row"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Cash Book & Banking</h1><p className="page-subtitle">Unbanked closing cash automatically carries into the next day.</p></div><Link href="/" className="btn-secondary rounded-xl px-3 py-2 text-sm font-bold">Back</Link></div>

      {isAdmin && <button onClick={() => setEntryMode(!entryMode)} className="mb-4 rounded-xl border border-[var(--line)] px-3 py-2 text-sm font-bold">{entryMode ? 'Hide entry forms' : 'Record expense / banking'}</button>}
      {isAdmin && flaggedPending.length > 0 && <button onClick={() => { setSelectedDay(flaggedPending[0].banking_date); setBankDate(flaggedPending[0].banking_date) }} className="mb-4 block w-full max-w-3xl rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-left text-sm font-bold text-red-500">{flaggedPending.length} flagged banking record(s) need review</button>}
      {message && <div className={`mb-4 max-w-3xl rounded-xl border p-3 text-sm ${message.type === 'success' ? 'border-green-500/30 bg-green-500/10 text-green-500' : message.type === 'warn' ? 'border-amber-500/30 bg-amber-500/10 text-amber-500' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}>{message.text}</div>}

      <div className="mb-6 flex max-w-3xl items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3"><button onClick={() => shiftDay(-1)} className="btn-secondary rounded-lg px-4 py-2 font-bold">←</button><input type="date" value={selectedDay} onChange={(e) => { const d = e.target.value || todayStr; setSelectedDay(d); setBankDate(d) }} className="input-base flex-1 text-center font-bold" /><button onClick={() => shiftDay(1)} className="btn-secondary rounded-lg px-4 py-2 font-bold">→</button>{selectedDay === todayStr && <span className="text-xs font-black text-green-500">TODAY</span>}</div>

      {openingCash > 0 && <div className="mb-5 max-w-3xl rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4"><p className="text-sm font-black text-amber-500">Opening cash carried forward</p><p className="mt-1 text-2xl font-black">{openingCash.toLocaleString()} UGX</p><p className="mt-1 text-xs text-muted">Unbanked cash remaining from previous day(s).</p></div>}

      <div className="mb-8 grid max-w-3xl grid-cols-2 gap-4 md:grid-cols-4">
        <div className="page-card p-4"><p className="text-xs text-muted">Cash received today</p><p className="mt-1 text-2xl font-black text-green-500">{cashIn.toLocaleString()}</p></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Expenses</p><p className="mt-1 text-2xl font-black text-red-500">{expTotal.toLocaleString()}</p></div>
        <div className="page-card border-amber-500/30 p-4"><p className="text-xs text-muted">Cash still on hand</p><p className="mt-1 text-2xl font-black text-amber-500">{expectedNow.toLocaleString()}</p></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Banked today</p><p className="mt-1 text-2xl font-black">{(bankedConfirmed + bankedPending).toLocaleString()}</p><p className="mt-1 text-xs text-muted">Confirmed {bankedConfirmed.toLocaleString()} · Pending {bankedPending.toLocaleString()}</p></div>
      </div>

      <section className="mb-10 max-w-3xl"><h2 className="mb-2 text-lg font-black">Expenses — {selectedDay}</h2><div className="page-card border-red-500/20 p-5">{canEnter && <><form onSubmit={addExpense} className="flex flex-col gap-3 md:flex-row"><input value={expDesc} onChange={(e) => setExpDesc(e.target.value)} required className="input-base flex-1" placeholder="What was the money used for?" /><select value={expCat} onChange={(e) => setExpCat(e.target.value)} className="input-base md:w-40">{categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select><input type="number" step="0.01" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} required className="input-base md:w-36" placeholder="Amount" /><button type="submit" className="rounded-xl bg-red-500 px-4 py-2 font-black text-white">Subtract</button></form>{isAdmin && <div className="mt-3 flex gap-2"><input value={newCat} onChange={(e) => setNewCat(e.target.value)} className="input-base flex-1" placeholder="Add expense category" /><button onClick={addCategory} type="button" className="btn-secondary rounded-xl px-3 font-bold">Add</button></div>}{isSuper && <div className="mt-3 flex flex-wrap gap-2">{categories.map(c => <button key={c.id} type="button" onClick={() => deleteCategory(c.id)} className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs text-muted">{c.name} ×</button>)}</div>}</>}
        <div className="mt-4 space-y-2">{dayExpenses.length === 0 && <p className="py-3 text-center text-sm text-muted">No expenses on this day.</p>}{dayExpenses.map(e => <div key={e.id} className="flex items-center justify-between rounded-xl bg-[var(--panel-2)] p-3"><div><p className="font-bold">{e.description}</p><p className="mt-1 text-xs text-muted">{e.category} · {userMap[e.recorded_by]?.full_name || profile.full_name}</p></div><p className="font-black text-red-500">−{Number(e.amount).toLocaleString()}</p></div>)}</div></div></section>

      <section className="mb-10 max-w-3xl"><h2 className="mb-2 text-lg font-black">Banking — {selectedDay}</h2><div className="page-card border-green-500/20 p-5"><div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><span className="text-muted">Available to bank now:</span> <strong className="text-amber-500">{expectedNow.toLocaleString()} UGX</strong></div>{canEnter && <form onSubmit={addBanking} className="space-y-3"><div className="flex flex-col gap-3 md:flex-row"><input type="date" value={bankDate} onChange={(e) => setBankDate(e.target.value)} className="input-base md:w-44" /><input type="number" step="0.01" value={bankAmount} onChange={(e) => setBankAmount(e.target.value)} required className="input-base flex-1" placeholder="Amount banked" /><input value={bankMethod} onChange={(e) => setBankMethod(e.target.value)} className="input-base flex-1" placeholder="Bank / MoMo / Cash box" /></div><input value={bankNotes} onChange={(e) => setBankNotes(e.target.value)} className="input-base" placeholder="Notes (optional)" />{bankVariance !== null && <div className={`rounded-xl p-3 text-sm font-bold ${Math.abs(bankVariance) < TOLERANCE ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>{Math.abs(bankVariance) < TOLERANCE ? 'Matches cash on hand exactly.' : `Difference ${bankVariance.toLocaleString()} UGX — this will be flagged.`}</div>}<button type="submit" className={`w-full rounded-xl py-3 font-black ${willFlag ? 'bg-red-500 text-white' : 'bg-amber-500 text-slate-950'}`}>{willFlag ? 'Submit flagged banking' : 'Submit banking'}</button></form>}
        <div className="mt-4 space-y-2">{dayBankings.length === 0 && <p className="py-3 text-center text-sm text-muted">No bankings on this day.</p>}{dayBankings.map(b => <div key={b.id} className={`rounded-xl border p-3 ${b.flagged ? 'border-red-500/40 bg-red-500/5' : 'border-[var(--line)] bg-[var(--panel-2)]'}`}><div className="flex items-center justify-between gap-3"><strong>{Number(b.amount_banked).toLocaleString()} UGX</strong><span className={b.status === 'confirmed' ? 'text-green-500' : 'text-amber-500'}>{b.status}</span></div><p className="mt-1 text-xs text-muted">{b.bank_or_method || 'No method'} · {userMap[b.recorded_by]?.full_name || 'staff'}</p>{isAdmin && b.status === 'pending' && <button onClick={() => confirmBanking(b)} className="mt-2 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-black text-slate-950">Confirm</button>}</div>)}</div></div></section>

      <section className="max-w-3xl"><h2 className="mb-1 text-lg font-black">Day-by-day archive</h2><p className="mb-3 text-xs text-muted">Complete cash history from the first day the Maya system became active. Days without transactions are included so carried-forward cash remains traceable.</p><div className="space-y-2">{archiveDays.map(day => { const sum = daySummary(day); return <button key={day} onClick={() => { setSelectedDay(day); setBankDate(day) }} className={`page-card w-full p-4 text-left ${day === selectedDay ? 'border-amber-500/40' : ''}`}><div className="flex items-center justify-between gap-3"><div><p className="font-black">{day === todayStr ? 'TODAY — ' : ''}{day}</p><p className="mt-1 text-xs text-muted">Opening {sum.open.toLocaleString()} · Received {sum.cIn.toLocaleString()} · Expenses {sum.eT.toLocaleString()} · Banked {sum.bT.toLocaleString()}</p></div><div className="text-right"><p className="text-xs text-muted">Closing cash</p><p className="font-black text-amber-500">{sum.closing.toLocaleString()}</p>{sum.flags > 0 && <p className="text-xs text-red-500">{sum.flags} flag(s)</p>}</div></div></button> })}</div></section>
    </main>
  )
}