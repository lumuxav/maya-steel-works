'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import ThemePicker from './components/ThemePicker'

const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const formatMoney = (value) => Number(value || 0).toLocaleString()

export default function HomePage() {
  const [profile, setProfile] = useState(null)
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
      if (!session) return (window.location.href = '/login')

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
      ;(raws || []).forEach((x) => {
        const branch = x.current_branch || 'Maya Branch'
        rb[branch] = (rb[branch] || 0) + 1
      })
      setRawBranches(rb)

      const { data: fgs } = await supabase.from('finished_goods').select('current_branch, quantity').gt('quantity', 0)
      const fb = {}
      ;(fgs || []).forEach((x) => {
        const branch = x.current_branch || 'Maya Branch'
        fb[branch] = (fb[branch] || 0) + 1
      })
      setFgBranches(fb)
      setLoading(false)
    }
    load()
  }, [])

  if (!profile || loading) return <main className="min-h-screen grid place-items-center text-sm text-muted">Loading dashboard...</main>

  const todayStr = toDayStr(new Date())
  const payBySale = {}
  events.forEach((e) => { if (e.sale_id) payBySale[e.sale_id] = (payBySale[e.sale_id] || 0) + Number(e.amount) })
  const saleTimePaid = (s) => Math.max(0, Number(s.amount_paid) - (payBySale[s.id] || 0))
  const cashInToday = sales.filter((s) => toDayStr(new Date(s.created_at)) === todayStr).reduce((sum, s) => sum + saleTimePaid(s), 0) + events.filter((e) => toDayStr(new Date(e.created_at)) === todayStr).reduce((sum, e) => sum + Number(e.amount), 0)
  const outstanding = sales.reduce((sum, s) => sum + Math.max(0, Number(s.total_amount) - Number(s.amount_paid) - (Number(s.adjustments) || 0)), 0)
  const pendingAmount = bankings.reduce((sum, b) => sum + Number(b.amount_banked), 0)
  const flaggedProd = runs.filter((r) => Number(r.boss_expected_yield) !== Number(r.actual_yield)).length
  const alertCount = bankings.length + flaggedProd + counts.length
  const branches = Array.from(new Set([...Object.keys(rawBranches), ...Object.keys(fgBranches)]))

  const ops = [
    ['/inventory', 'Inventory', 'Stock overview', '▦'],
    ['/deliveries', 'Receive Delivery', 'Incoming materials', '↓'],
    ['/sales', 'Record Sale', 'Sales and payments', '$'],
    ['/production', 'Production', 'Output and usage', '⚙'],
    ['/transfers', 'Transfers', 'Move stock', '⇄'],
    ['/stocktake', 'Stocktake', 'Physical counts', '✓'],
    ['/sales-report', 'Sales & Credit', 'Debtors and history', '≡'],
    ['/cashbook', 'Cash Book', 'Expenses and banking', '¤'],
  ]

  return (
    <main className="app-shell flex">
      <aside className="desktop-sidebar fixed inset-y-0 left-0 p-5">
        <div className="flex items-center gap-3 px-1">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--accent)] text-sm font-black text-white">MS</div>
          <div>
            <p className="font-black leading-tight">Maya Steel Works</p>
            <p className="text-xs text-muted">Management</p>
          </div>
        </div>

        <nav className="mt-8 space-y-1">
          <Link href="/" className="sidebar-link sidebar-link-active"><span className="nav-icon">⌂</span>Dashboard</Link>
          <Link href="/inventory" className="sidebar-link"><span className="nav-icon">▦</span>Inventory</Link>
          <Link href="/sales" className="sidebar-link"><span className="nav-icon">$</span>Sales</Link>
          <Link href="/production" className="sidebar-link"><span className="nav-icon">⚙</span>Production</Link>
          <Link href="/cashbook" className="sidebar-link"><span className="nav-icon">¤</span>Cash Book</Link>
          {isAdmin && <Link href="/alerts" className="sidebar-link"><span className="nav-icon">!</span>Alerts</Link>}
        </nav>

        <div className="absolute bottom-5 left-5 right-5">
          <ThemePicker />
          <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login' }} className="btn-secondary mt-3 w-full rounded-xl px-3 py-2.5 text-sm font-bold">Sign out</button>
        </div>
      </aside>

      <section className="mobile-safe-bottom min-w-0 flex-1 lg:ml-[248px]">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <header className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-muted">Good day,</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">{profile.full_name}</h1>
              <p className="mt-1 text-sm text-muted">Here’s what’s happening at Maya Steel Works.</p>
            </div>
            <div className="lg:hidden"><ThemePicker compact /></div>
          </header>

          {isAdmin && alertCount > 0 && (
            <Link href="/alerts" className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-red-400/25 bg-red-400/10 px-4 py-3.5">
              <div><p className="font-bold text-red-400">{alertCount} items need attention</p><p className="mt-1 text-xs text-muted">Banking, production or stock differences</p></div><span className="text-muted">→</span>
            </Link>
          )}

          <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Link href="/cashbook" className="soft-card p-5"><p className="text-sm text-muted">Cash in today</p><p className="metric-value-success mt-3 text-3xl font-black">{formatMoney(cashInToday)}</p><p className="mt-2 text-xs text-muted">Collected today</p></Link>
            <Link href="/sales-report?tab=debtors" className="soft-card p-5"><p className="text-sm text-muted">Outstanding credit</p><p className="metric-value-danger mt-3 text-3xl font-black">{formatMoney(outstanding)}</p><p className="mt-2 text-xs text-muted">Customer balances</p></Link>
            <Link href="/cashbook" className="soft-card p-5"><p className="text-sm text-muted">Pending banking</p><p className="metric-value-warning mt-3 text-3xl font-black">{bankings.length}</p><p className="mt-2 text-xs text-muted">{formatMoney(pendingAmount)} awaiting confirmation</p></Link>
            <Link href="/production-report" className="soft-card p-5"><p className="text-sm text-muted">Production flags</p><p className="metric-value-danger mt-3 text-3xl font-black">{flaggedProd}</p><p className="mt-2 text-xs text-muted">Outside expected yield</p></Link>
          </section>

          <section className="mt-8 grid gap-7 xl:grid-cols-[1.5fr_.8fr]">
            <div>
              <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-black">Operations</h2><span className="text-xs text-muted">Quick access</span></div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {ops.map(([href, title, desc, icon]) => (
                  <Link key={href} href={href} className="module-card">
                    <div className="nav-icon">{icon}</div>
                    <p className="mt-4 font-black">{title}</p>
                    <p className="mt-1 text-sm text-muted">{desc}</p>
                  </Link>
                ))}
              </div>

              {isAdmin && (
                <div className="mt-8">
                  <h2 className="mb-4 text-lg font-black">Management</h2>
                  <div className="soft-card overflow-hidden">
                    {[
                      ['/alerts','Activity & Alerts'], ['/production-report','Production Report'], ['/profit','Profit Dashboard'], ['/records','Records & Discrepancies'], ['/corrections','Corrections'], ...(profile.role === 'super_admin' ? [['/users','Users & Roles']] : [])
                    ].map(([href, title], i, arr) => (
                      <Link key={href} href={href} className="flex items-center justify-between px-5 py-4" style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : '0' }}><span className="font-bold">{title}</span><span className="text-muted">→</span></Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <aside>
              <h2 className="mb-4 text-lg font-black">Stock by branch</h2>
              <div className="soft-card p-4">
                {branches.length === 0 ? <p className="text-sm text-muted">No stock recorded.</p> : branches.map((branch) => (
                  <div key={branch} className="mb-3 rounded-2xl bg-[var(--panel-2)] p-4 last:mb-0">
                    <div className="flex items-center justify-between"><p className="font-black">{branch}</p><span className="text-xs text-muted">Live</span></div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-muted">Raw</p><p className="mt-1 font-black">{rawBranches[branch] || 0}</p></div><div><p className="text-muted">Finished</p><p className="mt-1 font-black">{fgBranches[branch] || 0}</p></div></div>
                  </div>
                ))}
              </div>
            </aside>
          </section>
        </div>
      </section>

      <nav className="mobile-bottom-nav">
        <Link href="/">Home</Link><Link href="/inventory">Inventory</Link><Link href="/sales">Sales</Link><Link href="/cashbook">Cash</Link>
      </nav>
    </main>
  )
}
