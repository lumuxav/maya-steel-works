'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'

const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function HomePage() {
  const [profile, setProfile] = useState(null)
  const [userId, setUserId] = useState(null)
  const [entryMode, setEntryMode] = useState(false)
  const [sales, setSales] = useState([])
  const [events, setEvents] = useState([])
  const [bankings, setBankings] = useState([])
  const [runs, setRuns] = useState([])
  const [counts, setCounts] = useState([])
  const [rawBranches, setRawBranches] = useState({})
  const [fgBranches, setFgBranches] = useState({})
  const [loading, setLoading] = useState(true)

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  useEffect(() => {
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

      let q = supabase.from('sales').select('*').limit(500)
      if (!admin) q = q.eq('sold_by', session.user.id)
      const { data: s } = await q
      setSales(s || [])

      const { data: ev } = await supabase.from('debt_events').select('*').eq('event_type', 'payment').limit(400)
      setEvents(ev || [])

      const { data: b } = await supabase.from('bankings').select('*').eq('status', 'pending').limit(100)
      setBankings(b || [])

      const { data: r } = await supabase.from('production_log').select('*').limit(300)
      setRuns(r || [])

      const { data: c } = await supabase.from('stocktakes').select('*').neq('difference', 0).limit(100)
      setCounts(c || [])

      const rawSource = admin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'
      const { data: raws } = await supabase.from(rawSource).select('current_branch, quantity').gt('quantity', 0)
      const rb = {}
      ;(raws || []).forEach(x => { rb[x.current_branch || 'Maya Branch'] = (rb[x.current_branch || 'Maya Branch'] || 0) + 1 })
      setRawBranches(rb)

      const { data: fgs } = await supabase.from('finished_goods').select('current_branch, quantity').gt('quantity', 0)
      const fb = {}
      ;(fgs || []).forEach(x => { fb[x.current_branch || 'Maya Branch'] = (fb[x.current_branch || 'Maya Branch'] || 0) + 1 })
      setFgBranches(fb)

      setLoading(false)
    }
    load()
  }, [])

  if (!profile || loading) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  const todayStr = toDayStr(new Date())
  const payBySale = {}
  events.forEach(e => { if (e.sale_id) payBySale[e.sale_id] = (payBySale[e.sale_id] || 0) + Number(e.amount) })
  const saleTimePaid = (s) => Math.max(0, Number(s.amount_paid) - (payBySale[s.id] || 0))
  const cashInToday =
    sales.filter(s => toDayStr(new Date(s.created_at)) === todayStr).reduce((sum, s) => sum + saleTimePaid(s), 0) +
    events.filter(e => toDayStr(new Date(e.created_at)) === todayStr).reduce((sum, e) => sum + Number(e.amount), 0)

  const outstanding = sales.reduce((sum, s) => {
    const bal = Number(s.total_amount) - Number(s.amount_paid) - (Number(s.adjustments) || 0)
    return sum + Math.max(0, bal)
  }, 0)

  const pendingAmount = bankings.reduce((sum, b) => sum + Number(b.amount_banked), 0)
  const flaggedProd = runs.filter(r => Number(r.boss_expected_yield) !== Number(r.actual_yield)).length
  const alertCount = bankings.length + flaggedProd + counts.length

  const branches = Array.from(new Set([...Object.keys(rawBranches), ...Object.keys(fgBranches)]))

  const NAV = [
    { href: '/inventory', icon: '📦', title: 'Inventory', desc: 'Live stock + item history reports' },
    { href: '/deliveries', icon: '📥', title: 'Receive Delivery', desc: 'Record a truck\'s items at once' },
    { href: '/sales', icon: '💰', title: 'Record Sale', desc: 'Sell from stock or make & sell' },
    { href: '/production', icon: '🏭', title: 'Record Production', desc: 'Used vs made vs standard' },
    { href: '/transfers', icon: '🚚', title: 'Branch Transfers', desc: 'Move stock with head names' },
    { href: '/stocktake', icon: '📋', title: 'Stocktake', desc: 'Physical count + reports' },
    { href: '/sales-report', icon: '💳', title: 'Sales & Credit Book', desc: 'Your sales + debtors' },
    { href: '/cashbook', icon: '🏦', title: 'Cash Book & Banking', desc: 'Expenses + end-of-day banking' }
  ]
  const ADMIN_NAV = [
    { href: '/alerts', icon: '🔔', title: 'Activity & Alerts', desc: 'Day-grouped feed with context' },
    { href: '/production-report', icon: '📊', title: 'Production Report', desc: 'Standards vs actuals' },
    { href: '/profit', icon: '📈', title: 'Profit Dashboard', desc: 'Boss eyes only' },
    { href: '/records', icon: '📚', title: 'Records & Discrepancies', desc: 'The permanent book' },
    { href: '/corrections', icon: '🛠️', title: 'Corrections', desc: 'Fix wrong entries, logged' }
  ]

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black text-white">MAYA STEEL WORKS</h1>
          <p className="text-slate-400 mt-1">Precision Metal Cutting & Pressing Solutions</p>
        </div>
        <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login' }}
          className="text-sm text-slate-300 border border-slate-600 rounded-lg px-4 py-2 hover:bg-slate-800">
          Sign Out
        </button>
      </header>

      <div className="bg-slate-800 rounded-xl p-6 mb-6 max-w-3xl">
        <p className="text-lg text-slate-300">Welcome, <span className="font-bold text-amber-400">{profile.full_name}</span>!</p>
        <p className="text-slate-400 mt-1">Your role: <span className="font-bold text-white uppercase">{profile.role}</span></p>
        <p className="text-sm text-slate-500 mt-3">
          {isAdmin ? 'Boss view: monitor the business flow. Staff do the data entry.' : 'Staff view: record deliveries, sales, production and counts.'}
        </p>
      </div>

      {isAdmin && alertCount > 0 && (
        <Link href="/alerts"
          className="block mb-6 max-w-3xl rounded-lg p-4 text-sm bg-red-900/60 text-red-100 border-2 border-red-500 font-bold hover:bg-red-900/80">
          🔔 {alertCount} items need your attention right now (pending bankings, production flags, count differences) — open the Activity & Alerts feed
        </Link>
      )}

      <div className="grid grid-cols-2 gap-4 max-w-3xl mb-6">
        <Link href="/cashbook" className="bg-slate-800 hover:bg-slate-700 rounded-xl p-5 border border-slate-700 transition">
          <p className="text-xs text-slate-400 uppercase">Cash in today</p>
          <p className="text-2xl font-black text-green-400 mt-1">{cashInToday.toLocaleString()}</p>
          <p className="text-[11px] text-slate-500 mt-2">tap → today's cash story</p>
        </Link>
        <Link href="/sales-report?tab=debtors" className="bg-slate-800 hover:bg-slate-700 rounded-xl p-5 border border-red-500/40 transition">
          <p className="text-xs text-slate-400 uppercase">Outstanding credit</p>
          <p className="text-2xl font-black text-red-400 mt-1">{outstanding.toLocaleString()}</p>
          <p className="text-[11px] text-slate-500 mt-2">tap → who owes what & why</p>
        </Link>
        <Link href="/cashbook" className="bg-slate-800 hover:bg-slate-700 rounded-xl p-5 border border-amber-500/40 transition">
          <p className="text-xs text-slate-400 uppercase">Bankings pending</p>
          <p className="text-2xl font-black text-amber-400 mt-1">{bankings.length} <span className="text-sm">({pendingAmount.toLocaleString()})</span></p>
          <p className="text-[11px] text-slate-500 mt-2">tap → review & confirm</p>
        </Link>
        <Link href="/production-report" className="bg-slate-800 hover:bg-slate-700 rounded-xl p-5 border border-red-500/40 transition">
          <p className="text-xs text-slate-400 uppercase">Flagged production</p>
          <p className="text-2xl font-black text-red-400 mt-1">{flaggedProd}</p>
          <p className="text-[11px] text-slate-500 mt-2">tap → see why each run flagged</p>
        </Link>
      </div>

      <div className="bg-slate-800 rounded-xl p-5 max-w-3xl mb-6 border border-slate-700">
        <p className="text-xs text-slate-400 uppercase mb-3">Stock presence per branch (batches)</p>
        <div className="space-y-2">
          {branches.map(b => (
            <div key={b} className="bg-slate-900/60 rounded-lg p-3">
              <p className="font-bold text-white">{b}</p>
              <p className="text-sm text-slate-400 mt-1">{rawBranches[b] || 0} raw batches · {fgBranches[b] || 0} finished batches</p>
            </div>
          ))}
        </div>
      </div>

      {isAdmin && (
        <button onClick={() => setEntryMode(!entryMode)}
          className="mb-6 text-sm border border-slate-600 text-slate-300 rounded-lg px-4 py-2 hover:bg-slate-800">
          🔧 Staff Entry Mode (record deliveries / sales / production)
        </button>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl">
        {NAV.map(n => (
          <Link key={n.href} href={n.href}
            className="bg-slate-800 hover:bg-slate-700 rounded-xl p-5 border border-slate-700 transition">
            <p className="text-2xl mb-2">{n.icon}</p>
            <p className="font-bold text-white">{n.title}</p>
            <p className="text-xs text-slate-400 mt-1">{n.desc}</p>
          </Link>
        ))}
        {isAdmin && ADMIN_NAV.map(n => (
          <Link key={n.href} href={n.href}
            className="bg-slate-800 hover:bg-slate-700 rounded-xl p-5 border border-amber-500/30 transition">
            <p className="text-2xl mb-2">{n.icon}</p>
            <p className="font-bold text-white">{n.title}</p>
            <p className="text-xs text-slate-400 mt-1">{n.desc}</p>
          </Link>
        ))}
        {profile.role === 'super_admin' && (
          <Link href="/users"
            className="bg-slate-800 hover:bg-slate-700 rounded-xl p-5 border border-purple-500/30 transition">
            <p className="text-2xl mb-2">👤</p>
            <p className="font-bold text-white">Users & Roles</p>
            <p className="text-xs text-slate-400 mt-1">Create staff, roles, deactivate, passwords</p>
          </Link>
        )}
      </div>
    </main>
  )
}