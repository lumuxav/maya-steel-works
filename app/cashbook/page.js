'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

const TOLERANCE = 1

const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function CashbookPage() {
  const now = new Date()
  const todayStr = toDayStr(now)

  const [profile, setProfile] = useState(null)
  const [userId, setUserId] = useState(null)
  const [entryMode, setEntryMode] = useState(false)
  const [selectedDay, setSelectedDay] = useState(todayStr)

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
    if (!session) {
      window.location.href = '/login'
      return
    }
    setUserId(session.user.id)
    const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
    setProfile(prof)
    const admin = prof?.role === 'admin' || prof?.role === 'super_admin'

    const { data: s } = await supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(400)
    setSales((s || []).filter(x => admin || x.sold_by === session.user.id))

    const { data: exps } = await supabase.from('expenses').select('*').order('created_at', { ascending: false }).limit(400)
    setExpenses(exps || [])

    const { data: banks } = await supabase.from('bankings').select('*').order('created_at', { ascending: false }).limit(400)
    setBankings(banks || [])

    const { data: ev } = await supabase.from('debt_events').select('*').order('created_at', { ascending: false }).limit(400)
    setEvents(ev || [])

    const { data: cats } = await supabase.from('expense_categories').select('*').order('name')
    setCategories(cats || [])

    if (admin) {
      const { data: users } = await supabase.from('users').select('id, full_name')
      setUserMap(Object.fromEntries((users || []).map(u => [u.id, u])))
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const d = params.get('day')
    if (d) setSelectedDay(d)
  }, [])

  // DAY-INTEGRITY MATH: cash received on a day = cash at sale (that day's sales) + payments received that day
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

  const inDay = (t, day) => toDayStr(new Date(t)) === day

  const visibleExpenses = expenses.filter(e => isAdmin || e.recorded_by === userId)

  const dayExpenses = visibleExpenses.filter(e => inDay(e.created_at, selectedDay))
  const dayBankings = bankings.filter(b => b.banking_date === selectedDay)

  const cashIn = collectedOnDay(selectedDay)
  const expTotal = dayExpenses.reduce((s, x) => s + Number(x.amount), 0)
  const bankedConfirmed = dayBankings.filter(b => b.status === 'confirmed').reduce((s, b) => s + Number(b.amount_banked), 0)
  const bankedPending = dayBankings.filter(b => b.status === 'pending').reduce((s, b) => s + Number(b.amount_banked), 0)
  const expectedNow = cashIn - expTotal - (bankedConfirmed + bankedPending)

  const bankVariance = bankAmount !== '' ? Number(bankAmount) - expectedNow : null
  const willFlag = bankVariance !== null && Math.abs(bankVariance) >= TOLERANCE

  const flaggedPending = bankings.filter(b => b.flagged && b.status === 'pending')

  const daySet = new Set()
  sales.forEach(s => daySet.add(toDayStr(new Date(s.created_at))))
  visibleExpenses.forEach(e => daySet.add(toDayStr(new Date(e.created_at))))
  bankings.forEach(b => daySet.add(b.banking_date))
  events.forEach(e => daySet.add(toDayStr(new Date(e.created_at))))
  const archiveDays = Array.from(daySet).sort().reverse().slice(0, 40)

  const daySummary = (day) => {
    const cIn = collectedOnDay(day)
    const eT = visibleExpenses.filter(e => inDay(e.created_at, day)).reduce((s, x) => s + Number(x.amount), 0)
    const bT = bankings.filter(b => b.banking_date === day).reduce((s, b) => s + Number(b.amount_banked), 0)
    const flags = bankings.filter(b => b.banking_date === day && b.flagged).length
    return { cIn, eT, bT, flags }
  }

  const shiftDay = (delta) => {
    const [y, m, d] = selectedDay.split('-').map(Number)
    const nd = new Date(y, m - 1, d + delta)
    setSelectedDay(toDayStr(nd))
  }

  const addCategory = async () => {
    if (!newCat.trim()) return
    const { error } = await supabase.from('expense_categories').insert({ name: newCat.trim(), created_by: userId })
    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setNewCat('')
      load()
    }
  }

  const deleteCategory = async (id) => {
    if (!window.confirm('Remove this expense category?')) return
    const { error } = await supabase.from('expense_categories').delete().eq('id', id)
    if (error) setMessage({ type: 'error', text: error.message })
    else load()
  }

  const addExpense = async (e) => {
    e.preventDefault()
    const { error } = await supabase.from('expenses').insert({
      description: expDesc, category: expCat, amount: Number(expAmount), recorded_by: userId
    })
    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setMessage({ type: 'success', text: 'Expense recorded — deducted from that day\'s cash.' })
      setExpDesc(''); setExpAmount('')
      load()
    }
  }

  const addBanking = async (e) => {
    e.preventDefault()
    const amt = Number(bankAmount)
    const variance = amt - expectedNow
    const flagged = Math.abs(variance) >= TOLERANCE

    const { error } = await supabase.from('bankings').insert({
      banking_date: bankDate || todayStr,
      amount_banked: amt,
      bank_or_method: bankMethod || null,
      notes: bankNotes || null,
      recorded_by: userId,
      status: 'pending',
      expected_amount: expectedNow,
      variance: variance,
      flagged: flagged
    })
    if (error) setMessage({ type: 'error', text: error.message })
    else if (flagged) {
      setMessage({ type: 'warn', text: `⚠️ Banking saved as PENDING and FLAGGED: variance ${variance.toLocaleString()} UGX. Admin alerted.` })
      setBankAmount(''); setBankMethod(''); setBankNotes('')
      load()
    } else {
      setMessage({ type: 'success', text: 'Banking recorded as PENDING — exact match, waiting for Admin confirmation.' })
      setBankAmount(''); setBankMethod(''); setBankNotes('')
      load()
    }
  }

  const confirmBanking = async (b) => {
    const name = userMap[b.recorded_by]?.full_name || 'staff'
    const flagNote = b.flagged ? `\n\n⚠️ FLAGGED: variance ${Number(b.variance).toLocaleString()} vs expected ${Number(b.expected_amount).toLocaleString()}.` : ''
    if (!window.confirm(`Confirm banking of ${Number(b.amount_banked).toLocaleString()} UGX by ${name} on ${b.banking_date}?${flagNote}`)) return
    const { error } = await supabase.from('bankings').update({
      status: 'confirmed', confirmed_by: userId, confirmed_at: new Date().toISOString()
    }).eq('id', b.id)
    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setMessage({ type: 'success', text: 'Banking CONFIRMED ✅' })
      load()
    }
  }

  if (!profile || loading) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">🏦 Cash Book & Banking</h1>
          <p className="text-slate-400 text-sm">One day at a time — every day keeps its full, unchangeable story</p>
        </div>
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
      </header>

      {isAdmin && (
        <button onClick={() => setEntryMode(!entryMode)}
          className="mb-4 text-sm border border-slate-600 text-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-800">
          {entryMode ? '👔 Hide staff entry forms (boss view)' : '🔧 Staff entry: record expense / banking'}
        </button>
      )}

      {isAdmin && flaggedPending.length > 0 && (
        <button
          onClick={() => setSelectedDay(flaggedPending[0].banking_date)}
          className="block mb-4 w-full max-w-3xl text-left rounded-lg p-3 text-sm bg-red-900/60 text-red-100 border-2 border-red-500 font-bold hover:bg-red-900/80"
        >
          🚨 ADMIN ALERT: {flaggedPending.length} flagged banking(s) — tap to open the day it happened ({flaggedPending[0].banking_date})
        </button>
      )}

      {message && (
        <div className={`mb-4 max-w-3xl rounded-lg p-3 text-sm ${
          message.type === 'success' ? 'bg-green-900/50 text-green-200 border border-green-700'
          : message.type === 'warn' ? 'bg-amber-900/50 text-amber-200 border border-amber-600'
          : 'bg-red-900/50 text-red-200 border border-red-700'
        }`}>
          {message.text}
        </div>
      )}

      <div className="flex items-center gap-3 mb-6 max-w-3xl bg-slate-800 rounded-xl p-3 border border-slate-700">
        <button onClick={() => shiftDay(-1)} className="px-4 py-2 rounded-lg bg-slate-700 text-white font-bold hover:bg-slate-600 text-lg">←</button>
        <input type="date" value={selectedDay} onChange={(e) => setSelectedDay(e.target.value || todayStr)}
          className="flex-1 rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-center font-bold text-base" />
        <button onClick={() => shiftDay(1)} className="px-4 py-2 rounded-lg bg-slate-700 text-white font-bold hover:bg-slate-600 text-lg">→</button>
        {selectedDay === todayStr && <span className="text-sm font-bold text-green-400 whitespace-nowrap">TODAY</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mb-8">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase">Cash received</p>
          <p className="text-2xl font-black text-green-400 mt-1">{cashIn.toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase">Expenses</p>
          <p className="text-2xl font-black text-red-400 mt-1">{expTotal.toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-amber-500/40">
          <p className="text-xs text-slate-400 uppercase">Still to hand in</p>
          <p className="text-2xl font-black text-amber-400 mt-1">{expectedNow.toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase">Banked</p>
          <p className="text-2xl font-black text-white mt-1">{(bankedConfirmed + bankedPending).toLocaleString()}</p>
          <p className="text-xs text-slate-500 mt-1">✅ {bankedConfirmed.toLocaleString()} · 🟠 {bankedPending.toLocaleString()}</p>
        </div>
      </div>

      <section className="max-w-3xl mb-10">
        <h2 className="text-lg font-bold text-white mb-1">💸 MONEY OUT — Expenses of {selectedDay}</h2>
        <div className="bg-slate-800 border-2 border-red-500/30 rounded-xl p-5">
          {canEnter ? (
            <>
              <form onSubmit={addExpense} className="flex flex-col md:flex-row gap-3">
                <input value={expDesc} onChange={(e) => setExpDesc(e.target.value)} required
                  className="flex-1 rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-base"
                  placeholder="What was the money used for?" />
                <select value={expCat} onChange={(e) => setExpCat(e.target.value)}
                  className="md:w-40 rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-base">
                  {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                <input type="number" step="0.01" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} required
                  className="md:w-36 rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-base"
                  placeholder="Amount" />
                <button type="submit" className="bg-red-500 hover:bg-red-400 text-white font-bold text-sm px-4 py-2 rounded-lg whitespace-nowrap">
                  − Subtract
                </button>
              </form>
              {isAdmin && (
                <div className="flex gap-2 mt-3">
                  <input value={newCat} onChange={(e) => setNewCat(e.target.value)}
                    className="flex-1 rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm"
                    placeholder="Admin: add new expense category (e.g. Fuel)" />
                  <button onClick={addCategory} className="text-sm bg-slate-700 hover:bg-slate-600 text-white font-bold px-3 py-2 rounded-lg">+ Add</button>
                </div>
              )}
              {isSuper && categories.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {categories.map(c => (
                    <button key={c.id} onClick={() => deleteCategory(c.id)}
                      className="text-xs bg-slate-900 border border-slate-700 text-slate-400 px-2 py-1 rounded hover:border-red-500 hover:text-red-400">
                      {c.name} ✕
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">Staff record expenses here. As Admin you review the list below.</p>
          )}

          <div className="space-y-2 mt-4">
            {dayExpenses.length === 0 && <p className="text-sm text-slate-500 text-center py-3">No expenses on this day.</p>}
            {dayExpenses.map(e => (
              <div key={e.id} className="flex items-center justify-between bg-slate-900/50 rounded-lg p-3 text-base">
                <div>
                  <p className="font-semibold text-white">{e.description}</p>
                  <p className="text-xs text-slate-500 mt-1">{e.category} · {isAdmin ? (userMap[e.recorded_by]?.full_name || '—') : profile.full_name} · {new Date(e.created_at).toLocaleTimeString()}</p>
                </div>
                <p className="font-bold text-red-400 text-lg">−{Number(e.amount).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-3xl mb-10">
        <h2 className="text-lg font-bold text-white mb-1">🏦 MONEY IN — Bankings of {selectedDay}</h2>
        <div className="bg-slate-800 border-2 border-green-500/30 rounded-xl p-5">
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-3 mb-4 text-base">
            <span className="text-slate-300">Cash still expected for this day:</span>{' '}
            <span className="font-black text-amber-400 text-xl">{expectedNow.toLocaleString()} UGX</span>
          </div>

          {canEnter ? (
            <form onSubmit={addBanking} className="space-y-3">
              <div className="flex flex-col md:flex-row gap-3">
                <input type="date" value={bankDate} onChange={(e) => setBankDate(e.target.value)}
                  className="md:w-44 rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-base" />
                <input type="number" step="0.01" value={bankAmount} onChange={(e) => setBankAmount(e.target.value)} required
                  className="flex-1 rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-base"
                  placeholder="Amount banked / handed in" />
                <input value={bankMethod} onChange={(e) => setBankMethod(e.target.value)}
                  className="flex-1 rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-base"
                  placeholder="Bank / MoMo / Cash box" />
              </div>
              <input value={bankNotes} onChange={(e) => setBankNotes(e.target.value)}
                className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-base"
                placeholder="Notes (optional)" />

              {bankVariance !== null && (
                <div className={`rounded-lg p-3 text-base font-bold ${Math.abs(bankVariance) < TOLERANCE ? 'bg-green-900/40 text-green-300 border border-green-700' : 'bg-red-900/40 text-red-300 border border-red-600'}`}>
                  {Math.abs(bankVariance) < TOLERANCE
                    ? '✅ Matches expected cash exactly.'
                    : `⚠️ VARIANCE ${bankVariance.toLocaleString()} UGX — will be FLAGGED and alert Admin.`}
                </div>
              )}

              <button type="submit" className={`w-full font-bold text-base py-3 rounded-lg ${willFlag ? 'bg-red-500 hover:bg-red-400 text-white' : 'bg-amber-500 hover:bg-amber-400 text-slate-900'}`}>
                {willFlag ? '⚠️ Submit FLAGGED Banking' : 'Submit Banking for Confirmation'}
              </button>
            </form>
          ) : (
            <p className="text-sm text-slate-500">Staff submit bankings here. Your job: review & confirm below.</p>
          )}

          <div className="space-y-2 mt-4">
            {dayBankings.length === 0 && <p className="text-sm text-slate-500 text-center py-3">No bankings on this day.</p>}
            {dayBankings.map(b => (
              <div key={b.id} className={`rounded-lg p-3 text-base border ${b.flagged ? 'border-red-500/50 bg-red-900/10' : 'border-slate-700 bg-slate-900/50'}`}>
                <div className="flex items-center justify-between">
                  <p className="font-bold text-white">{Number(b.amount_banked).toLocaleString()} UGX <span className="text-sm font-normal text-slate-400">· {b.bank_or_method || 'no method'}</span></p>
                  <span className={`text-sm font-bold uppercase ${b.status === 'confirmed' ? 'text-green-400' : 'text-amber-400'}`}>
                    {b.status === 'confirmed' ? '✅ confirmed' : '🟠 pending'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  by {isAdmin ? (userMap[b.recorded_by]?.full_name || '—') : profile.full_name}
                  {b.flagged && <span className="text-red-400 font-bold"> · ⚠️ variance {Number(b.variance).toLocaleString()} (expected {Number(b.expected_amount).toLocaleString()})</span>}
                  {b.notes && ` · 📝 ${b.notes}`}
                </p>
                {isAdmin && b.status === 'pending' && (
                  <button onClick={() => confirmBanking(b)} className="mt-2 text-sm bg-green-500 text-slate-900 font-bold px-3 py-1.5 rounded hover:bg-green-400">
                    Confirm Banking
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-3xl">
        <h2 className="text-lg font-bold text-white mb-3">🗂️ Day-by-Day Archive</h2>
        <div className="space-y-2">
          {archiveDays.map(day => {
            const sum = daySummary(day)
            return (
              <button key={day} onClick={() => setSelectedDay(day)}
                className={`w-full flex items-center justify-between rounded-xl p-4 border text-left transition ${day === selectedDay ? 'border-amber-500 bg-amber-500/10' : 'border-slate-700 bg-slate-800 hover:bg-slate-700'}`}>
                <div>
                  <p className="font-bold text-white text-base">{day === todayStr ? 'TODAY — ' : ''}{day}</p>
                  <p className="text-sm text-slate-400 mt-1">
                    in <span className="text-green-400 font-bold">{sum.cIn.toLocaleString()}</span> ·
                    out <span className="text-red-400 font-bold">{sum.eT.toLocaleString()}</span> ·
                    banked <span className="text-white font-bold">{sum.bT.toLocaleString()}</span>
                  </p>
                </div>
                {sum.flags > 0 && <span className="text-base font-bold text-red-400">⚠️ {sum.flags}</span>}
              </button>
            )
          })}
        </div>
      </section>
    </main>
  )
}