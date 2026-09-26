'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { SYSTEM_BRANCH, getSystemUserIds, getSystemRawIds, getSystemFinishedIds } from '../lib/branch'
import { getSessionProfile } from '../lib/sessionCache'
import ProfileAvatar from './components/ProfileAvatar'

const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const formatMoney = (value) => Number(value || 0).toLocaleString()

export default function HomePage() {
  const [profile, setProfile] = useState(null)
  const [userId, setUserId] = useState(null)
  const [sales, setSales] = useState([])
  const [events, setEvents] = useState([])
  const [bankings, setBankings] = useState([])
  const [runs, setRuns] = useState([])
  const [counts, setCounts] = useState([])
  const [rawCount, setRawCount] = useState(0)
  const [finishedCount, setFinishedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  useEffect(() => {
    const load = async () => {
      try {
        const { session, profile: prof } = await getSessionProfile()
        if (!session) return (window.location.href = '/login')
        setUserId(session.user.id)
        setProfile(prof)

        const [systemUsers, rawIds, finishedIds, salesRes, eventsRes, banksRes, runsRes, countsRes, rawsRes, fgsRes] = await Promise.all([
          getSystemUserIds(supabase),
          getSystemRawIds(supabase),
          getSystemFinishedIds(supabase),
          supabase.from('sales').select('*').limit(500),
          supabase.from('debt_events').select('*').eq('event_type', 'payment').limit(400),
          supabase.from('bankings').select('*').eq('status', 'pending').limit(100),
          supabase.from('production_log').select('*').limit(300),
          supabase.from('stocktakes').select('*').neq('difference', 0).limit(100),
          supabase.from('raw_materials_admin_view').select('id, current_branch, quantity').gt('quantity', 0),
          supabase.from('finished_goods').select('id, current_branch, quantity').gt('quantity', 0),
        ])

        const branchSales = (salesRes.data || []).filter(x => systemUsers.has(x.sold_by))
        setSales((prof?.role === 'admin' || prof?.role === 'super_admin') ? branchSales : branchSales.filter(x => x.sold_by === session.user.id))

        const saleIds = new Set(branchSales.map(x => x.id))
        setEvents((eventsRes.data || []).filter(x => (x.sale_id && saleIds.has(x.sale_id)) || (!x.sale_id && systemUsers.has(x.received_by))))
        setBankings((banksRes.data || []).filter(x => systemUsers.has(x.recorded_by)))
        setRuns((runsRes.data || []).filter(x => rawIds.has(x.raw_material_id) || finishedIds.has(x.finished_good_id)))
        setCounts((countsRes.data || []).filter(x => x.item_type === 'raw' ? rawIds.has(x.item_id) : finishedIds.has(x.item_id)))
        setRawCount((rawsRes.data || []).filter(x => rawIds.has(x.id)).length)
        setFinishedCount((fgsRes.data || []).filter(x => finishedIds.has(x.id)).length)
      } finally {
        setLoading(false)
      }
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
  const todaySales = sales.filter((s) => toDayStr(new Date(s.created_at)) === todayStr).length
  const initials = (profile.full_name || 'MS').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()

  const ops = [
    ['/inventory', 'Inventory', 'Maya Branch stock', '▦'],
    ['/deliveries', 'Receive Delivery', 'Incoming materials', '↓'],
    ['/sales', 'Record Sale', 'Sell Maya-owned stock', '$'],
    ['/customer-work', 'Customer Material', 'Press, cut or shape customer-owned metal', '🛠'],
    ['/production', 'Production', 'Output and usage', '⚙'],
    ['/stocktake', 'Stocktake', 'Physical counts', '✓'],
    ['/sales-report', 'Sales & Credit', 'Debtors and history', '≡'],
    ['/cashbook', 'Cash Book', 'Expenses and banking', '¤'],
  ]

  return (
    <main className="page-wrap">
      <section className="home-hero-grid">
        <div className="home-welcome-card">
          <p className="page-eyebrow">{SYSTEM_BRANCH}</p>
          <h1 className="home-greeting">Hi {profile.full_name?.split(' ')[0] || 'there'}!</h1>
          <p className="page-subtitle">Here’s what’s happening at Maya Steel Works today.</p>
          <div className="home-quick-row">
            <Link href="/sales" className="home-quick-action"><span>＋</span><div><strong>New sale</strong><small>Sell Maya stock</small></div></Link>
            <Link href="/customer-work" className="home-quick-action"><span>🛠</span><div><strong>Customer material</strong><small>Record processing work</small></div></Link>
          </div>
        </div>

        <section className="home-profile-card" aria-label="User profile summary">
          <ProfileAvatar userId={userId} initials={initials} className="home-profile-avatar" />
          <div className="home-profile-name">{profile.full_name}</div>
          <div className="home-profile-role">{profile.role?.replaceAll('_', ' ')}</div>
          <div className="home-profile-stats">
            <div><strong>{todaySales}</strong><span>Transactions today</span></div>
            <div><strong>{rawCount + finishedCount}</strong><span>Active stock types</span></div>
            <div><strong>{alertCount}</strong><span>Alerts</span></div>
          </div>
          <span className="home-profile-note">Profile changes are managed in Settings</span>
        </section>
      </section>

      {isAdmin && alertCount > 0 && (
        <Link href="/alerts" className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-red-400/25 bg-red-400/10 px-4 py-3.5">
          <div><p className="font-bold text-red-500">{alertCount} Maya Branch items need attention</p><p className="mt-1 text-xs text-muted">Banking, production or stock differences</p></div><span className="text-muted">→</span>
        </Link>
      )}

      <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/cashbook" className="page-card p-5"><p className="text-sm text-muted">Cash in today</p><p className="metric-value-success mt-3 text-3xl font-black">{formatMoney(cashInToday)}</p><p className="mt-2 text-xs text-muted">Collected at Maya Branch</p></Link>
        <Link href="/sales-report?tab=debtors" className="page-card p-5"><p className="text-sm text-muted">Outstanding credit</p><p className="metric-value-danger mt-3 text-3xl font-black">{formatMoney(outstanding)}</p><p className="mt-2 text-xs text-muted">Maya Branch customer balances</p></Link>
        <Link href="/cashbook" className="page-card p-5"><p className="text-sm text-muted">Pending banking</p><p className="metric-value-warning mt-3 text-3xl font-black">{bankings.length}</p><p className="mt-2 text-xs text-muted">{formatMoney(pendingAmount)} awaiting confirmation</p></Link>
        <Link href="/production-report" className="page-card p-5"><p className="text-sm text-muted">Production flags</p><p className="metric-value-danger mt-3 text-3xl font-black">{flaggedProd}</p><p className="mt-2 text-xs text-muted">Maya Branch output variance</p></Link>
      </section>

      <section className="mt-8 grid gap-7 xl:grid-cols-[1.5fr_.8fr]">
        <div>
          <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-black">Operations</h2><span className="text-xs text-muted">Maya Branch only</span></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ops.map(([href, title, desc, icon]) => (
              <Link key={href} href={href} className="page-card p-4 transition hover:-translate-y-0.5">
                <div className="settings-row-icon">{icon}</div><p className="mt-4 font-black">{title}</p><p className="mt-1 text-sm text-muted">{desc}</p>
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
          <h2 className="mb-4 text-lg font-black">Maya Branch stock</h2>
          <div className="page-card p-4">
            <div className="rounded-2xl bg-[var(--panel-2)] p-4">
              <div className="flex items-center justify-between"><p className="font-black">{SYSTEM_BRANCH}</p><span className="text-xs text-muted">Live</span></div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-muted">Raw</p><p className="mt-1 font-black">{rawCount}</p></div><div><p className="text-muted">Finished</p><p className="mt-1 font-black">{finishedCount}</p></div></div>
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
