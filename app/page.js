'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'

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

  if (!profile || loading) return <main className="page-wrap text-muted">Loading dashboard...</main>

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
  const todaySales = sales.filter((s) => toDayStr(new Date(s.created_at)) === todayStr).length
  const initials = (profile.full_name || 'MS').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()

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
    <main className="page-wrap">
      <section className="home-hero-grid">
        <div className="home-welcome-card">
          <p className="page-eyebrow">Home</p>
          <h1 className="home-greeting">Hi {profile.full_name?.split(' ')[0] || 'there'}!</h1>
          <p className="page-subtitle">Here’s what’s happening at Maya Steel Works today.</p>

          <div className="home-quick-row">
            <Link href="/sales" className="home-quick-action"><span>＋</span><div><strong>New sale</strong><small>Record a customer sale</small></div></Link>
            <Link href="/deliveries" className="home-quick-action"><span>↓</span><div><strong>Receive stock</strong><small>Add incoming materials</small></div></Link>
          </div>
        </div>

        <Link href="/settings" className="home-profile-card">
          <div className="home-profile-avatar">{initials}</div>
          <div className="home-profile-name">{profile.full_name}</div>
          <div className="home-profile-role">{profile.role?.replaceAll('_', ' ')}</div>
          <div className="home-profile-stats">
            <div><strong>{todaySales}</strong><span>Sales today</span></div>
            <div><strong>{branches.length}</strong><span>Branches</span></div>
            <div><strong>{alertCount}</strong><span>Alerts</span></div>
          </div>
          <span className="home-profile-link">View profile & settings →</span>
        </Link>
      </section>

      {isAdmin && alertCount > 0 && (
        <Link href="/alerts" className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-red-400/25 bg-red-400/10 px-4 py-3.5">
          <div><p className="font-bold text-red-500">{alertCount} items need attention</p><p className="mt-1 text-xs text-muted">Banking, production or stock differences</p></div><span className="text-muted">→</span>
        </Link>
      )}

      <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/cashbook" className="page-card p-5"><p className="text-sm text-muted">Cash in today</p><p className="metric-value-success mt-3 text-3xl font-black">{formatMoney(cashInToday)}</p><p className="mt-2 text-xs text-muted">Collected today</p></Link>
        <Link href="/sales-report?tab=debtors" className="page-card p-5"><p className="text-sm text-muted">Outstanding credit</p><p className="metric-value-danger mt-3 text-3xl font-black">{formatMoney(outstanding)}</p><p className="mt-2 text-xs text-muted">Customer balances</p></Link>
        <Link href="/cashbook" className="page-card p-5"><p className="text-sm text-muted">Pending banking</p><p className="metric-value-warning mt-3 text-3xl font-black">{bankings.length}</p><p className="mt-2 text-xs text-muted">{formatMoney(pendingAmount)} awaiting confirmation</p></Link>
        <Link href="/production-report" className="page-card p-5"><p className="text-sm text-muted">Production flags</p><p className="metric-value-danger mt-3 text-3xl font-black">{flaggedProd}</p><p className="mt-2 text-xs text-muted">Outside expected yield</p></Link>
      </section>

      <section className="mt-8 grid gap-7 xl:grid-cols-[1.5fr_.8fr]">
        <div>
          <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-black">Operations</h2><span className="text-xs text-muted">Quick access</span></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ops.map(([href, title, desc, icon]) => (
              <Link key={href} href={href} className="page-card p-4 transition hover:-translate-y-0.5">
                <div className="settings-row-icon">{icon}</div>
                <p className="mt-4 font-black">{title}</p>
                <p className="mt-1 text-sm text-muted">{desc}</p>
              </Link>
            ))}
          </div>

          {isAdmin && (
            <div className="mt-8">
              <h2 className="mb-4 text-lg font-black">Management</h2>
              <div className="settings-list">
                {[
                  ['/alerts','Activity & Alerts'], ['/production-report','Production Report'], ['/profit','Profit Dashboard'], ['/records','Records & Discrepancies'], ['/corrections','Corrections'], ...(profile.role === 'super_admin' ? [['/users','Users & Roles']] : [])
                ].map(([href, title]) => (
                  <Link key={href} href={href} className="settings-row"><span className="settings-row-icon">›</span><div><strong>{title}</strong></div><span className="settings-chevron">›</span></Link>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside>
          <h2 className="mb-4 text-lg font-black">Stock by branch</h2>
          <div className="page-card p-4">
            {branches.length === 0 ? <p className="text-sm text-muted">No stock recorded.</p> : branches.map((branch) => (
              <div key={branch} className="mb-3 rounded-2xl bg-[var(--panel-2)] p-4 last:mb-0">
                <div className="flex items-center justify-between"><p className="font-black">{branch}</p><span className="text-xs text-muted">Live</span></div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-muted">Raw</p><p className="mt-1 font-black">{rawBranches[branch] || 0}</p></div><div><p className="text-muted">Finished</p><p className="mt-1 font-black">{fgBranches[branch] || 0}</p></div></div>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </main>
  )
}
