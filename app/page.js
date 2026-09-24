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
      if (!session) {
        window.location.href = '/login'
        return
      }

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

  if (!profile || loading) {
    return <main className="min-h-screen grid place-items-center text-sm text-muted">Loading dashboard...</main>
  }

  const todayStr = toDayStr(new Date())
  const payBySale = {}
  events.forEach((e) => {
    if (e.sale_id) payBySale[e.sale_id] = (payBySale[e.sale_id] || 0) + Number(e.amount)
  })

  const saleTimePaid = (s) => Math.max(0, Number(s.amount_paid) - (payBySale[s.id] || 0))
  const cashInToday =
    sales.filter((s) => toDayStr(new Date(s.created_at)) === todayStr).reduce((sum, s) => sum + saleTimePaid(s), 0) +
    events.filter((e) => toDayStr(new Date(e.created_at)) === todayStr).reduce((sum, e) => sum + Number(e.amount), 0)

  const outstanding = sales.reduce((sum, s) => {
    const bal = Number(s.total_amount) - Number(s.amount_paid) - (Number(s.adjustments) || 0)
    return sum + Math.max(0, bal)
  }, 0)

  const pendingAmount = bankings.reduce((sum, b) => sum + Number(b.amount_banked), 0)
  const flaggedProd = runs.filter((r) => Number(r.boss_expected_yield) !== Number(r.actual_yield)).length
  const alertCount = bankings.length + flaggedProd + counts.length
  const branches = Array.from(new Set([...Object.keys(rawBranches), ...Object.keys(fgBranches)]))

  const NAV = [
    { href: '/inventory', title: 'Inventory', desc: 'Raw materials and finished goods' },
    { href: '/deliveries', title: 'Receive Delivery', desc: 'Incoming stock and truck deliveries' },
    { href: '/sales', title: 'Record Sale', desc: 'Sales and make-to-sell entries' },
    { href: '/production', title: 'Record Production', desc: 'Materials used and output made' },
    { href: '/transfers', title: 'Branch Transfers', desc: 'Move stock between branches' },
    { href: '/stocktake', title: 'Stocktake', desc: 'Physical count and differences' },
    { href: '/sales-report', title: 'Sales & Credit Book', desc: 'Sales, debtors and payments' },
    { href: '/cashbook', title: 'Cash Book & Banking', desc: 'Expenses and end-of-day banking' },
  ]

  const ADMIN_NAV = [
    { href: '/alerts', title: 'Activity & Alerts', desc: 'Items needing management attention' },
    { href: '/production-report', title: 'Production Report', desc: 'Expected versus actual output' },
    { href: '/profit', title: 'Profit Dashboard', desc: 'Profitability and management figures' },
    { href: '/records', title: 'Records & Discrepancies', desc: 'Operational records and exceptions' },
    { href: '/corrections', title: 'Corrections', desc: 'Fix entries with an audit trail' },
  ]

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--line)' }}>
          <div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Maya Steel Works</h1>
            <p className="mt-1 text-sm text-muted">Management System</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ThemePicker compact />
            <div className="surface hidden rounded-lg px-3 py-2 sm:block">
              <p className="text-sm font-bold">{profile.full_name}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted">{profile.role}</p>
            </div>
            <button
              onClick={async () => {
                await supabase.auth.signOut()
                window.location.href = '/login'
              }}
              className="btn-secondary rounded-lg px-3 py-2 text-sm font-bold"
            >
              Sign out
            </button>
          </div>
        </header>

        {isAdmin && alertCount > 0 && (
          <Link href="/alerts" className="mt-5 block rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">
            <span className="font-bold text-red-400">{alertCount} items need attention.</span>
            <span className="ml-2 text-muted">Review pending banking, production flags and stock differences.</span>
          </Link>
        )}

        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-[0.12em] text-muted">Overview</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Link href="/cashbook" className="surface rounded-xl p-4">
              <p className="text-sm text-muted">Cash in today</p>
              <p className="metric-value-success mt-2 text-2xl font-black">{formatMoney(cashInToday)}</p>
            </Link>
            <Link href="/sales-report?tab=debtors" className="surface rounded-xl p-4">
              <p className="text-sm text-muted">Outstanding credit</p>
              <p className="metric-value-danger mt-2 text-2xl font-black">{formatMoney(outstanding)}</p>
            </Link>
            <Link href="/cashbook" className="surface rounded-xl p-4">
              <p className="text-sm text-muted">Pending banking</p>
              <p className="metric-value-warning mt-2 text-2xl font-black">{bankings.length}</p>
              <p className="mt-1 text-xs text-muted">{formatMoney(pendingAmount)} awaiting confirmation</p>
            </Link>
            <Link href="/production-report" className="surface rounded-xl p-4">
              <p className="text-sm text-muted">Production flags</p>
              <p className="metric-value-danger mt-2 text-2xl font-black">{flaggedProd}</p>
            </Link>
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_0.75fr]">
          <div>
            <h2 className="mb-3 text-sm font-black uppercase tracking-[0.12em] text-muted">Operations</h2>
            <div className="surface overflow-hidden rounded-xl">
              <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {NAV.map((item) => (
                  <Link key={item.href} href={item.href} className="flex items-center justify-between gap-4 px-4 py-4 hover:opacity-80" style={{ borderColor: 'var(--line)' }}>
                    <div>
                      <p className="font-bold">{item.title}</p>
                      <p className="mt-1 text-sm text-muted">{item.desc}</p>
                    </div>
                    <span className="text-muted">→</span>
                  </Link>
                ))}
              </div>
            </div>

            {isAdmin && (
              <>
                <h2 className="mb-3 mt-6 text-sm font-black uppercase tracking-[0.12em] text-muted">Management</h2>
                <div className="surface overflow-hidden rounded-xl">
                  <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
                    {ADMIN_NAV.map((item) => (
                      <Link key={item.href} href={item.href} className="flex items-center justify-between gap-4 px-4 py-4 hover:opacity-80" style={{ borderColor: 'var(--line)' }}>
                        <div>
                          <p className="font-bold">{item.title}</p>
                          <p className="mt-1 text-sm text-muted">{item.desc}</p>
                        </div>
                        <span className="text-muted">→</span>
                      </Link>
                    ))}
                    {profile.role === 'super_admin' && (
                      <Link href="/users" className="flex items-center justify-between gap-4 px-4 py-4 hover:opacity-80" style={{ borderColor: 'var(--line)' }}>
                        <div>
                          <p className="font-bold">Users & Roles</p>
                          <p className="mt-1 text-sm text-muted">Create staff, roles and account access</p>
                        </div>
                        <span className="text-muted">→</span>
                      </Link>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <aside>
            <h2 className="mb-3 text-sm font-black uppercase tracking-[0.12em] text-muted">Stock by branch</h2>
            <div className="surface rounded-xl p-4">
              {branches.length === 0 ? (
                <p className="text-sm text-muted">No stock currently recorded.</p>
              ) : (
                <div className="space-y-3">
                  {branches.map((branch) => (
                    <div key={branch} className="surface-subtle rounded-lg px-3 py-3">
                      <p className="font-bold">{branch}</p>
                      <div className="mt-2 flex gap-4 text-sm text-muted">
                        <span>{rawBranches[branch] || 0} raw</span>
                        <span>{fgBranches[branch] || 0} finished</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </section>
      </div>
    </main>
  )
}
