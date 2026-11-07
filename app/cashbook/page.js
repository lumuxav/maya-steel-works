'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { SYSTEM_BRANCH, isSystemBranch } from '../../lib/branch'
import { MAYA_LAUNCH_DAY, MAYA_LAUNCH_LABEL, mayaBusinessDay, addBusinessDays, businessArchiveDays, saleCashAtTransaction, receivedOnDay, openingCashForDay as calculateOpeningCash, closingCash } from '../../lib/mayaBusiness.mjs'

import { readAllRows } from '../../lib/mayaReportData.mjs'

const TOLERANCE = 1
const PRODUCTION_START_DAY = MAYA_LAUNCH_DAY

export default function CashbookPage() {
  const todayStr = mayaBusinessDay()
  const [profile, setProfile] = useState(null)
  const [userId, setUserId] = useState(null)
  const [entryMode, setEntryMode] = useState(false)
  const [selectedDay, setSelectedDay] = useState(todayStr < PRODUCTION_START_DAY ? PRODUCTION_START_DAY : todayStr)
  const systemStartDay = PRODUCTION_START_DAY
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
  const [bankDate, setBankDate] = useState(todayStr < PRODUCTION_START_DAY ? PRODUCTION_START_DAY : todayStr)
  const [bankAmount, setBankAmount] = useState('')
  const [bankMethod, setBankMethod] = useState('')
  const [bankNotes, setBankNotes] = useState('')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)
  const confirmationIds = useRef({})
  const [confirmingId, setConfirmingId] = useState(null)

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
  const isSuper = profile?.role === 'super_admin'
  const canEnter = !isAdmin || entryMode

  const load = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return (window.location.href = '/login')
      setUserId(session.user.id)
      if (todayStr < PRODUCTION_START_DAY) {
        const { data: prelaunchProfile, error: profileError } = await supabase.from('users')
          .select('full_name, role, branch').eq('id', session.user.id).single()
        if (profileError) throw profileError
        setProfile(prelaunchProfile)
        return
      }

      const read = (table, columns = '*') => readAllRows(() => supabase.from(table).select(columns, { count: 'exact' })).then(data => ({ data }))
      const [profileRes, usersRes, salesRes, expensesRes, bankingsRes, eventsRes, categoriesRes] = await Promise.all([
        supabase.from('users').select('full_name, role, branch').eq('id', session.user.id).single(),
        read('users', 'id, full_name, branch'),
        read('sales'),
        read('expenses'),
        read('bankings'),
        read('debt_events'),
        supabase.from('expense_categories').select('*').order('name')
      ])
      const errors = [profileRes, usersRes, salesRes, expensesRes, bankingsRes, eventsRes, categoriesRes].map((res) => res.error).filter(Boolean)
      if (errors.length) throw new Error(errors[0].message)
      const prof = profileRes.data
      if (!prof) throw new Error('Your Maya staff profile is unavailable.')
      setProfile(prof)

      const systemUsers = new Set((usersRes.data || []).filter(user => isSystemBranch(user.branch)).map(user => user.id))
      const systemProfiles = (usersRes.data || []).filter((user) => systemUsers.has(user.id))
      setUserMap(Object.fromEntries(systemProfiles.map((user) => [user.id, user])))
      const branchSales = (salesRes.data || []).filter((sale) => systemUsers.has(sale.sold_by))
      setSales((prof.role === 'admin' || prof.role === 'super_admin')
        ? branchSales : branchSales.filter((sale) => sale.sold_by === session.user.id))
      const branchSaleIds = new Set(branchSales.map((sale) => sale.id))
      setExpenses((expensesRes.data || []).filter((exp) => systemUsers.has(exp.recorded_by)))
      setBankings((bankingsRes.data || []).filter((bank) => systemUsers.has(bank.recorded_by)))
      setEvents((eventsRes.data || []).filter((event) =>
        (event.sale_id && branchSaleIds.has(event.sale_id)) || (!event.sale_id && systemUsers.has(event.received_by))))
      const categories = categoriesRes.data || []
      setCategories(categories)
      if (categories.length) setExpCat((current) => categories.some((cat) => cat.name === current) ? current : categories[0].name)
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Could not load cash records. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get('day')
    if (d && d >= PRODUCTION_START_DAY && d <= todayStr) {
      setSelectedDay(d)
      setBankDate(d)
    }
  }, [todayStr])

  const saleTimePaid = (sale) => saleCashAtTransaction(sale, events)
  const collectedOnDay = (day) => receivedOnDay(sales, events, day)
  const inDay = (timestamp, day) => mayaBusinessDay(timestamp) === day
  const visibleExpenses = expenses.filter((expense) => isAdmin || expense.recorded_by === userId)
  const openingCashForDay = (day) => calculateOpeningCash(sales, events, visibleExpenses, bankings, day, PRODUCTION_START_DAY)

  const dayExpenses = visibleExpenses.filter(e => inDay(e.created_at, selectedDay))
  const dayBankings = bankings.filter(b => b.banking_date === selectedDay)
  const openingCash = openingCashForDay(selectedDay)
  const cashIn = collectedOnDay(selectedDay)
  const daySales = sales.filter(s => inDay(s.created_at, selectedDay))
  const stockSalesCash = daySales.filter(s => s.item_type !== 'service').reduce((sum, s) => sum + saleTimePaid(s), 0)
  const serviceSalesCash = daySales.filter(s => s.item_type === 'service').reduce((sum, s) => sum + saleTimePaid(s), 0)
  const dayDebtPayments = events.filter(e => e.event_type === 'payment' && inDay(e.created_at, selectedDay))
  const debtPaymentCash = dayDebtPayments.reduce((sum, e) => sum + Number(e.amount), 0)
  const knownCashSources = stockSalesCash + serviceSalesCash + debtPaymentCash
  const otherCash = Math.max(0, cashIn - knownCashSources)
  const expTotal = dayExpenses.reduce((s, x) => s + Number(x.amount), 0)
  const bankedConfirmed = dayBankings.filter(b => b.status === 'confirmed').reduce((s, b) => s + Number(b.amount_banked), 0)
  const bankedPending = dayBankings.filter(b => b.status === 'pending').reduce((s, b) => s + Number(b.amount_banked), 0)
  const expectedNow = closingCash(openingCash, cashIn, expTotal, bankedConfirmed)
  const bankVariance = bankAmount !== '' ? Number(bankAmount) - expectedNow : null
  const willFlag = bankVariance !== null && Math.abs(bankVariance) >= TOLERANCE
  const flaggedPending = bankings.filter(b => b.flagged && b.status === 'pending' && b.banking_date >= PRODUCTION_START_DAY)

  const archiveDays = businessArchiveDays(systemStartDay, todayStr)

  const daySummary = (day) => {
    const open = openingCashForDay(day)
    const cIn = collectedOnDay(day)
    const eT = visibleExpenses.filter(e => inDay(e.created_at, day)).reduce((s, x) => s + Number(x.amount), 0)
    const bT = bankings.filter(b => b.banking_date === day && b.status === 'confirmed').reduce((s, b) => s + Number(b.amount_banked), 0)
    const closing = closingCash(open, cIn, eT, bT)
    const flags = bankings.filter(b => b.banking_date === day && b.flagged).length
    return { open, cIn, eT, bT, closing, flags }
  }

  const shiftDay = (delta) => {
    const nd = addBusinessDays(selectedDay, delta)
    if (nd < PRODUCTION_START_DAY || nd > todayStr) return
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
    const amountEntered = Number(expAmount)
    if (!expDesc.trim() || !Number.isFinite(amountEntered) || amountEntered <= 0) {
      setMessage({ type: 'error', text: 'Expense description and a positive amount are required.' })
      return
    }
    if (mayaBusinessDay() < PRODUCTION_START_DAY) {
      setMessage({ type: 'error', text: 'Transactions cannot be recorded before the Maya launch date.' })
      return
    }
    const { error } = await supabase.from('expenses').insert({ description: expDesc.trim(), category: expCat, amount: amountEntered, recorded_by: userId })
    if (error) setMessage({ type: 'error', text: error.message }); else { setMessage({ type: 'success', text: 'Expense recorded for Maya Branch.' }); setExpDesc(''); setExpAmount(''); load() }
  }
  const addBanking = async (e) => {
    e.preventDefault()
    const amt = Number(bankAmount)
    if (!Number.isFinite(amt) || amt <= 0 || bankDate < PRODUCTION_START_DAY || bankDate > todayStr || mayaBusinessDay() < PRODUCTION_START_DAY) {
      setMessage({ type: 'error', text: 'Choose a valid Maya operating day and enter a positive banking amount.' })
      return
    }
    const variance = amt - expectedNow
    const flagged = Math.abs(variance) >= TOLERANCE
    const { error } = await supabase.from('bankings').insert({ banking_date: bankDate || selectedDay, amount_banked: amt, bank_or_method: bankMethod || null, notes: bankNotes || null, recorded_by: userId, status: 'pending', expected_amount: expectedNow, variance, flagged })
    if (error) setMessage({ type: 'error', text: error.message })
    else { setMessage(flagged ? { type: 'warn', text: `Banking saved and flagged. Difference: ${variance.toLocaleString()} UGX.` } : { type: 'success', text: 'Banking recorded and awaiting confirmation.' }); setBankAmount(''); setBankMethod(''); setBankNotes(''); load() }
  }
  const confirmBanking = async (b) => {
    if (!isAdmin || confirmingId) return
    if (!window.confirm(`Confirm ${Number(b.amount_banked).toLocaleString()} UGX banked on ${b.banking_date}?`)) return
    const operationId = confirmationIds.current[b.id] || crypto.randomUUID()
    confirmationIds.current[b.id] = operationId
    setConfirmingId(b.id)
    try {
      const { error } = await supabase.rpc('maya_correct_record', {
        p_table: 'bankings', p_row_id: b.id,
        p_changes: { status: 'confirmed' },
        p_reason: 'Banking confirmed by management',
        p_request_id: operationId,
      })
      if (error) throw error
      delete confirmationIds.current[b.id]
      setMessage({ type: 'success', text: 'Banking confirmed and recorded in the correction audit.' })
      await load()
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Could not confirm banking.' })
    } finally {
      setConfirmingId(null)
    }
  }

  if (loading) return <main className="page-wrap text-muted">Loading cash book...</main>
  if (!profile) return <main className="page-wrap"><p role="alert">{message?.text || 'Your Maya profile could not be loaded.'}</p><button className="btn-secondary mt-4 rounded-xl p-3" onClick={() => { setLoading(true); load() }}>Retry</button></main>

  if (todayStr < PRODUCTION_START_DAY) {
    return (
      <main className="page-wrap">
        <div className="page-header-row">
          <div>
            <p className="page-eyebrow">{SYSTEM_BRANCH}</p>
            <h1 className="page-title">Cash Book & Banking</h1>
            <p className="page-subtitle">A clean financial history for Maya Steel Works.</p>
          </div>
          <Link href="/" className="btn-secondary rounded-xl px-3 py-2 text-sm font-bold">Back</Link>
        </div>
        <section className="page-card max-w-3xl p-7 sm:p-9">
          <p className="page-eyebrow">Fresh start</p>
          <h2 className="text-2xl font-black">Cash Book opens {MAYA_LAUNCH_LABEL}</h2>
          <p className="mt-3 text-sm text-muted">The business archive begins on the first operating day. Dates before 31 October will not appear. Sales, expenses, banking and carried-forward cash will be tracked from the launch date.</p>
        {isAdmin && <Link href="/profit" className="btn-secondary mt-5 inline-block rounded-xl px-4 py-3 font-bold">View Period Report</Link>}
        </section>
      </main>
    )
  }

  return (
    <main className="page-wrap">
      <div className="page-header-row"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Cash Book & Banking</h1><p className="page-subtitle">Unbanked closing cash automatically carries into the next day.</p></div><Link href="/" className="btn-secondary rounded-xl px-3 py-2 text-sm font-bold">Back</Link></div>

      {isAdmin && <Link href="/profit" className="mb-4 block max-w-3xl rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 font-bold">Period Report <span className="mt-1 block text-xs font-normal text-muted">Choose a start and end date to view sales, cash, expenses and profit estimates.</span></Link>}
      {isAdmin && <button onClick={() => setEntryMode(!entryMode)} className="mb-4 rounded-xl border border-[var(--line)] px-3 py-2 text-sm font-bold">{entryMode ? 'Hide entry forms' : 'Record expense / banking'}</button>}
      {isAdmin && flaggedPending.length > 0 && <button onClick={() => { setSelectedDay(flaggedPending[0].banking_date); setBankDate(flaggedPending[0].banking_date) }} className="mb-4 block w-full max-w-3xl rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-left text-sm font-bold text-red-500">{flaggedPending.length} flagged banking record(s) need review</button>}
      {message && <div className={`mb-4 max-w-3xl rounded-xl border p-3 text-sm ${message.type === 'success' ? 'border-green-500/30 bg-green-500/10 text-green-500' : message.type === 'warn' ? 'border-amber-500/30 bg-amber-500/10 text-amber-500' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}>{message.text}</div>}

      <div className="mb-6 flex max-w-3xl items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3"><button onClick={() => shiftDay(-1)} disabled={selectedDay <= PRODUCTION_START_DAY} className="btn-secondary rounded-lg px-4 py-2 font-bold disabled:cursor-not-allowed disabled:opacity-40">←</button><input type="date" min={PRODUCTION_START_DAY} max={todayStr} value={selectedDay} onChange={(e) => { const d = e.target.value || todayStr; if (d >= PRODUCTION_START_DAY && d <= todayStr) { setSelectedDay(d); setBankDate(d) } }} className="input-base flex-1 text-center font-bold" /><button onClick={() => shiftDay(1)} disabled={selectedDay >= todayStr} className="btn-secondary rounded-lg px-4 py-2 font-bold disabled:cursor-not-allowed disabled:opacity-40">→</button>{selectedDay === todayStr && <span className="text-xs font-black text-green-500">TODAY</span>}</div>

      {openingCash > 0 && <div className="mb-5 max-w-3xl rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4"><p className="text-sm font-black text-amber-500">Opening cash carried forward</p><p className="mt-1 text-2xl font-black">{openingCash.toLocaleString()} UGX</p><p className="mt-1 text-xs text-muted">Unbanked cash remaining from previous day(s).</p></div>}

      <div className="mb-5 grid max-w-3xl grid-cols-2 gap-4 md:grid-cols-4">
        <div className="page-card p-4"><p className="text-xs text-muted">Cash received on this day</p><p className="mt-1 text-2xl font-black text-green-500">{cashIn.toLocaleString()}</p></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Expenses</p><p className="mt-1 text-2xl font-black text-red-500">{expTotal.toLocaleString()}</p></div>
        <div className="page-card border-amber-500/30 p-4"><p className="text-xs text-muted">Cash still on hand</p><p className="mt-1 text-2xl font-black text-amber-500">{expectedNow.toLocaleString()}</p></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Banked on this day</p><p className="mt-1 text-2xl font-black">{(bankedConfirmed + bankedPending).toLocaleString()}</p><p className="mt-1 text-xs text-muted">Confirmed {bankedConfirmed.toLocaleString()} · Pending {bankedPending.toLocaleString()}</p></div>
      </div>

      <section className="mb-8 max-w-3xl">
        <div className="mb-2 flex items-end justify-between gap-3"><div><h2 className="text-lg font-black">Where the cash came from</h2><p className="mt-1 text-xs text-muted">Breakdown of the {cashIn.toLocaleString()} UGX received on {selectedDay}.</p></div></div>
        <div className="page-card overflow-hidden">
          <div className="grid grid-cols-2 gap-px bg-[var(--line)] sm:grid-cols-4">
            <div className="bg-[var(--panel)] p-4"><p className="text-xs text-muted">Stock sales</p><p className="mt-1 text-lg font-black">{stockSalesCash.toLocaleString()}</p></div>
            <div className="bg-[var(--panel)] p-4"><p className="text-xs text-muted">Labour &amp; customer material</p><p className="mt-1 text-lg font-black">{serviceSalesCash.toLocaleString()}</p></div>
            <div className="bg-[var(--panel)] p-4"><p className="text-xs text-muted">Debt repayments</p><p className="mt-1 text-lg font-black text-green-500">{debtPaymentCash.toLocaleString()}</p></div>
            <div className="bg-[var(--panel)] p-4"><p className="text-xs text-muted">Other cash</p><p className="mt-1 text-lg font-black">{otherCash.toLocaleString()}</p></div>
          </div>
          {dayDebtPayments.length > 0 && <div className="border-t border-[var(--line)] p-4 sm:p-5"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-black">Debt payments received</h3><Link href="/alerts" className="text-xs font-bold text-green-500">View activity</Link></div><div className="space-y-2">{dayDebtPayments.map(p => <div key={p.id} className="flex items-start justify-between gap-3 rounded-xl bg-[var(--panel-2)] p-3"><div><p className="font-bold">{p.customer_name || 'Customer'}</p><p className="mt-1 text-xs text-muted">{p.sale_id ? `Sale #${p.sale_id}` : 'Account payment / advance'} · received by {userMap[p.received_by]?.full_name || 'staff'} · {new Date(p.created_at).toLocaleTimeString()}</p>{p.notes && <p className="mt-1 text-xs text-muted">{p.notes}</p>}</div><p className="font-black text-green-500">+{Number(p.amount).toLocaleString()}</p></div>)}</div></div>}
        </div>
      </section>

      <section className="mb-10 max-w-3xl"><h2 className="mb-2 text-lg font-black">Expenses — {selectedDay}</h2><div className="page-card border-red-500/20 p-5">{canEnter && <><form onSubmit={addExpense} className="flex flex-col gap-3 md:flex-row"><input value={expDesc} onChange={(e) => setExpDesc(e.target.value)} required className="input-base flex-1" placeholder="What was the money used for?" /><select value={expCat} onChange={(e) => setExpCat(e.target.value)} className="input-base md:w-40">{categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select><input type="number" step="0.01" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} required className="input-base md:w-36" placeholder="Amount" /><button type="submit" className="rounded-xl bg-red-500 px-4 py-2 font-black text-white">Subtract</button></form>{isAdmin && <div className="mt-3 flex gap-2"><input value={newCat} onChange={(e) => setNewCat(e.target.value)} className="input-base flex-1" placeholder="Add expense category" /><button onClick={addCategory} type="button" className="btn-secondary rounded-xl px-3 font-bold">Add</button></div>}{isSuper && <div className="mt-3 flex flex-wrap gap-2">{categories.map(c => <button key={c.id} type="button" onClick={() => deleteCategory(c.id)} className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs text-muted">{c.name} ×</button>)}</div>}</>}
        <div className="mt-4 space-y-2">{dayExpenses.length === 0 && <p className="py-3 text-center text-sm text-muted">No expenses on this day.</p>}{dayExpenses.map(e => <div key={e.id} className="flex items-center justify-between rounded-xl bg-[var(--panel-2)] p-3"><div><p className="font-bold">{e.description}</p><p className="mt-1 text-xs text-muted">{e.category} · {userMap[e.recorded_by]?.full_name || profile.full_name}</p></div><p className="font-black text-red-500">−{Number(e.amount).toLocaleString()}</p></div>)}</div></div></section>

      <section className="mb-10 max-w-3xl"><h2 className="mb-2 text-lg font-black">Banking — {selectedDay}</h2><div className="page-card border-green-500/20 p-5"><div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><span className="text-muted">Available to bank now:</span> <strong className="text-amber-500">{expectedNow.toLocaleString()} UGX</strong></div>{canEnter && <form onSubmit={addBanking} className="space-y-3"><div className="flex flex-col gap-3 md:flex-row"><input type="date" min={PRODUCTION_START_DAY} max={todayStr} value={bankDate} onChange={(e) => setBankDate(e.target.value)} className="input-base md:w-44" /><input type="number" step="0.01" value={bankAmount} onChange={(e) => setBankAmount(e.target.value)} required className="input-base flex-1" placeholder="Amount banked" /><input value={bankMethod} onChange={(e) => setBankMethod(e.target.value)} className="input-base flex-1" placeholder="Bank / MoMo / Cash box" /></div><input value={bankNotes} onChange={(e) => setBankNotes(e.target.value)} className="input-base" placeholder="Notes (optional)" />{bankVariance !== null && <div className={`rounded-xl p-3 text-sm font-bold ${Math.abs(bankVariance) < TOLERANCE ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>{Math.abs(bankVariance) < TOLERANCE ? 'Matches cash on hand exactly.' : `Difference ${bankVariance.toLocaleString()} UGX — this will be flagged.`}</div>}<button type="submit" className={`w-full rounded-xl py-3 font-black ${willFlag ? 'bg-red-500 text-white' : 'bg-amber-500 text-slate-950'}`}>{willFlag ? 'Submit flagged banking' : 'Submit banking'}</button></form>}
        <div className="mt-4 space-y-2">{dayBankings.length === 0 && <p className="py-3 text-center text-sm text-muted">No bankings on this day.</p>}{dayBankings.map(b => <div key={b.id} className={`rounded-xl border p-3 ${b.flagged ? 'border-red-500/40 bg-red-500/5' : 'border-[var(--line)] bg-[var(--panel-2)]'}`}><div className="flex items-center justify-between gap-3"><strong>{Number(b.amount_banked).toLocaleString()} UGX</strong><span className={b.status === 'confirmed' ? 'text-green-500' : 'text-amber-500'}>{b.status}</span></div><p className="mt-1 text-xs text-muted">{b.bank_or_method || 'No method'} · {userMap[b.recorded_by]?.full_name || 'staff'}</p>{isAdmin && b.status === 'pending' && <button onClick={() => confirmBanking(b)} className="mt-2 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-black text-slate-950">Confirm</button>}</div>)}</div></div></section>

      <section className="max-w-3xl"><h2 className="mb-1 text-lg font-black">Day-by-day archive</h2><p className="mb-3 text-xs text-muted">Complete cash history from Maya's production go-live date. Days without transactions are included from that point onward so carried-forward cash remains traceable. Only confirmed banking is deducted from closing cash.</p><div className="space-y-2">{archiveDays.map(day => { const sum = daySummary(day); return <button key={day} onClick={() => { setSelectedDay(day); setBankDate(day) }} className={`page-card w-full p-4 text-left ${day === selectedDay ? 'border-amber-500/40' : ''}`}><div className="flex items-center justify-between gap-3"><div><p className="font-black">{day === todayStr ? 'TODAY — ' : ''}{day}</p><p className="mt-1 text-xs text-muted">Opening {sum.open.toLocaleString()} · Received {sum.cIn.toLocaleString()} · Expenses {sum.eT.toLocaleString()} · Banked {sum.bT.toLocaleString()}</p></div><div className="text-right"><p className="text-xs text-muted">Closing cash</p><p className="font-black text-amber-500">{sum.closing.toLocaleString()}</p>{sum.flags > 0 && <p className="text-xs text-red-500">{sum.flags} flag(s)</p>}</div></div></button> })}</div></section>
    </main>
  )
}
