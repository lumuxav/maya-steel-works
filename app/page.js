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
      if (!session) {
        window.location.href = '/login'
        return
      }

      const { data: prof } = await supabase
        .from('users')
        .select('full_name, role')
        .eq('id', session.user.id)
        .single()

      setProfile(prof)
      const admin = prof?.role === 'admin' || prof?.role === 'super_admin'

      let q = supabase.from('sales').select('*').limit(500)
      if (!admin) q = q.eq('sold_by', session.user.id)
      const { data: s } = await q
      setSales(s || [])

      const { data: ev } = await supabase
        .from('debt_events')
        .select('*')
        .eq('event_type', 'payment')
        .limit(400)
      setEvents(ev || [])

      const { data: b } = await supabase
        .from('bankings')
        .select('*')
        .eq('status', 'pending')
        .limit(100)
      setBankings(b || [])

      const { data: r } = await supabase.from('production_log').select('*').limit(300)
      setRuns(r || [])

      const { data: c } = await supabase
        .from('stocktakes')
        .select('*')
        .neq('difference', 0)
        .limit(100)
      setCounts(c || [])

      const rawSource = admin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'
      const { data: raws } = await supabase
        .from(rawSource)
        .select('current_branch, quantity')
        .gt('quantity', 0)

      const rb = {}
      ;(raws || []).forEach((x) => {
        const branch = x.current_branch || 'Maya Branch'
        rb[branch] = (rb[branch] || 0) + 1
      })
      setRawBranches(rb)

      const { data: fgs } = await supabase
        .from('finished_goods')
        .select('current_branch, quantity')
        .gt('quantity', 0)

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
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 px-5 py-4 text-sm text-slate-300 shadow-xl">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" />
          Loading Maya Steel Works dashboard...
        </div>
      </main>
    )
  }

  const todayStr = toDayStr(new Date())
  const payBySale = {}
  events.forEach((e) => {
    if (e.sale_id) payBySale[e.sale_id] = (payBySale[e.sale_id] || 0) + Number(e.amount)
  })

  const saleTimePaid = (s) => Math.max(0, Number(s.amount_paid) - (payBySale[s.id] || 0))
  const cashInToday =
    sales
      .filter((s) => toDayStr(new Date(s.created_at)) === todayStr)
      .reduce((sum, s) => sum + saleTimePaid(s), 0) +
    events
      .filter((e) => toDayStr(new Date(e.created_at)) === todayStr)
      .reduce((sum, e) => sum + Number(e.amount), 0)

  const outstanding = sales.reduce((sum, s) => {
    const bal = Number(s.total_amount) - Number(s.amount_paid) - (Number(s.adjustments) || 0)
    return sum + Math.max(0, bal)
  }, 0)

  const pendingAmount = bankings.reduce((sum, b) => sum + Number(b.amount_banked), 0)
  const flaggedProd = runs.filter((r) => Number(r.boss_expected_yield) !== Number(r.actual_yield)).length
  const alertCount = bankings.length + flaggedProd + counts.length
  const branches = Array.from(new Set([...Object.keys(rawBranches), ...Object.keys(fgBranches)]))

  const NAV = [
    { href: '/inventory', icon: '▦', title: 'Inventory', desc: 'Live raw material and finished goods stock.' },
    { href: '/deliveries', icon: '↓', title: 'Receive Delivery', desc: 'Record incoming stock and truck deliveries.' },
    { href: '/sales', icon: '$', title: 'Record Sale', desc: 'Sell from stock or make and sell.' },
    { href: '/production', icon: '⚙', title: 'Record Production', desc: 'Capture materials used and output made.' },
    { href: '/transfers', icon: '⇄', title: 'Branch Transfers', desc: 'Move stock safely between branches.' },
    { href: '/stocktake', icon: '✓', title: 'Stocktake', desc: 'Compare physical counts against system stock.' },
    { href: '/sales-report', icon: '≡', title: 'Sales & Credit Book', desc: 'Review sales, debtors and payment history.' },
    { href: '/cashbook', icon: '¤', title: 'Cash Book & Banking', desc: 'Track expenses and end-of-day banking.' },
  ]

  const ADMIN_NAV = [
    { href: '/alerts', icon: '!', title: 'Activity & Alerts', desc: 'Review items needing management attention.' },
    { href: '/production-report', icon: '▤', title: 'Production Report', desc: 'Compare expected and actual production.' },
    { href: '/profit', icon: '↗', title: 'Profit Dashboard', desc: 'Management view of business profitability.' },
    { href: '/records', icon: '▧', title: 'Records & Discrepancies', desc: 'Permanent operational records and exceptions.' },
    { href: '/corrections', icon: '✎', title: 'Corrections', desc: 'Correct wrong entries with an audit trail.' },
  ]

  const metricCards = [
    {
      href: '/cashbook',
      label: 'Cash in today',
      value: formatMoney(cashInToday),
      note: 'Today’s collected cash',
      tone: 'text-emerald-300',
      border: 'border-emerald-500/20',
    },
    {
      href: '/sales-report?tab=debtors',
      label: 'Outstanding credit',
      value: formatMoney(outstanding),
      note: 'Open customer balances',
      tone: 'text-rose-300',
      border: 'border-rose-500/20',
    },
    {
      href: '/cashbook',
      label: 'Pending banking',
      value: `${bankings.length}`,
      note: `${formatMoney(pendingAmount)} awaiting confirmation`,
      tone: 'text-amber-300',
      border: 'border-amber-500/20',
    },
    {
      href: '/production-report',
      label: 'Production flags',
      value: `${flaggedProd}`,
      note: 'Runs outside expected yield',
      tone: 'text-orange-300',
      border: 'border-orange-500/20',
    },
  ]

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-5 border-b border-slate-800 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl border border-amber-400/20 bg-amber-400/10 font-black text-amber-300">
                MS
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-400">Management System</p>
                <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">Maya Steel Works</h1>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              Monitor stock, production, sales, banking and operational exceptions from one dashboard.
            </p>
          </div>

          <div className="flex items-center gap-3 self-start sm:self-auto">
            <div className="hidden rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-2.5 text-right sm:block">
              <p className="text-sm font-bold text-white">{profile.full_name}</p>
              <p className="text-xs uppercase tracking-wide text-slate-500">{profile.role}</p>
            </div>
            <button
              onClick={async () => {
                await supabase.auth.signOut()
                window.location.href = '/login'
              }}
              className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm font-bold text-slate-300 transition hover:border-slate-600 hover:bg-slate-800 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </header>

        <section className="mt-7 flex flex-col gap-4 rounded-2xl border border-slate-700/70 bg-slate-900/60 p-5 shadow-xl shadow-black/10 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <p className="text-sm text-slate-400">Welcome back</p>
            <h2 className="mt-1 text-2xl font-black text-white">{profile.full_name}</h2>
            <p className="mt-2 text-sm text-slate-400">
              {isAdmin
                ? 'Management view is active. You can review business-wide activity and exceptions.'
                : 'Staff view is active. Record daily operations accurately as work happens.'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Access level</p>
            <p className="mt-1 font-black uppercase text-amber-300">{profile.role}</p>
          </div>
        </section>

        {isAdmin && alertCount > 0 && (
          <Link
            href="/alerts"
            className="mt-5 flex flex-col gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 transition hover:bg-red-500/15 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-black text-red-100">{alertCount} items need management attention</p>
              <p className="mt-1 text-sm text-red-200/70">Pending bankings, production flags and stock count differences.</p>
            </div>
            <span className="text-sm font-bold text-red-200">Open alerts →</span>
          </Link>
        )}

        <section className="mt-7">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Business snapshot</p>
              <h2 className="mt-1 text-xl font-black text-white">Today at a glance</h2>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metricCards.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className={`group rounded-2xl border ${card.border} bg-slate-900/65 p-5 transition hover:-translate-y-0.5 hover:bg-slate-800/80`}
              >
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{card.label}</p>
                <p className={`mt-3 text-3xl font-black ${card.tone}`}>{card.value}</p>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-xs leading-5 text-slate-500">{card.note}</p>
                  <span className="text-slate-600 transition group-hover:translate-x-1 group-hover:text-slate-300">→</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[1.45fr_0.75fr]">
          <div>
            <div className="mb-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Daily operations</p>
              <h2 className="mt-1 text-xl font-black text-white">Work areas</h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="group rounded-2xl border border-slate-700/70 bg-slate-900/60 p-5 transition hover:-translate-y-0.5 hover:border-amber-400/30 hover:bg-slate-800/80"
                >
                  <div className="mb-5 grid h-10 w-10 place-items-center rounded-xl border border-slate-700 bg-slate-950/60 text-lg font-black text-amber-300">
                    {n.icon}
                  </div>
                  <p className="font-black text-white">{n.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{n.desc}</p>
                  <p className="mt-4 text-xs font-bold text-slate-600 transition group-hover:text-amber-300">Open module →</p>
                </Link>
              ))}
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-slate-700/70 bg-slate-900/60 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Stock presence</p>
                  <h2 className="mt-1 text-lg font-black text-white">By branch</h2>
                </div>
                <Link href="/inventory" className="text-xs font-bold text-amber-300 hover:text-amber-200">Inventory →</Link>
              </div>

              <div className="mt-5 space-y-3">
                {branches.length > 0 ? branches.map((branch) => (
                  <div key={branch} className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-bold text-white">{branch}</p>
                      <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-400">
                        {(rawBranches[branch] || 0) + (fgBranches[branch] || 0)} batches
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <div className="rounded-lg bg-slate-900 px-3 py-2">Raw: <span className="font-bold text-slate-300">{rawBranches[branch] || 0}</span></div>
                      <div className="rounded-lg bg-slate-900 px-3 py-2">Finished: <span className="font-bold text-slate-300">{fgBranches[branch] || 0}</span></div>
                    </div>
                  </div>
                )) : (
                  <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">No positive stock batches are currently available.</p>
                )}
              </div>
            </div>

            {isAdmin && (
              <div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.04] p-5">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400/70">Management controls</p>
                <div className="mt-4 space-y-2">
                  {ADMIN_NAV.map((n) => (
                    <Link
                      key={n.href}
                      href={n.href}
                      className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-3 transition hover:border-slate-700 hover:bg-slate-900/70"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900 font-black text-amber-300">{n.icon}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-white">{n.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">{n.desc}</span>
                      </span>
                    </Link>
                  ))}

                  {profile.role === 'super_admin' && (
                    <Link
                      href="/users"
                      className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-3 transition hover:border-slate-700 hover:bg-slate-900/70"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900 font-black text-amber-300">+</span>
                      <span>
                        <span className="block text-sm font-bold text-white">Users & Roles</span>
                        <span className="mt-0.5 block text-xs text-slate-500">Manage staff access and roles.</span>
                      </span>
                    </Link>
                  )}
                </div>
              </div>
            )}
          </aside>
        </section>
      </div>
    </main>
  )
}
