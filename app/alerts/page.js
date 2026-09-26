'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { SYSTEM_BRANCH, getSystemUserIds, getSystemRawIds, getSystemFinishedIds } from '../../lib/branch'

const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function AlertsPage() {
  const [profile, setProfile] = useState(null)
  const [feed, setFeed] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return (window.location.href = '/login')
      const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
      setProfile(prof)
      if (!(prof?.role === 'admin' || prof?.role === 'super_admin')) { setLoading(false); return }

      const systemUsers = await getSystemUserIds(supabase)
      const rawIds = await getSystemRawIds(supabase)
      const finishedIds = await getSystemFinishedIds(supabase)
      const events = []

      const { data: sales } = await supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(200)
      ;(sales || []).filter(s => systemUsers.has(s.sold_by)).forEach(s => {
        if (s.payment_status !== 'paid') {
          const bal = Number(s.total_amount) - Number(s.amount_paid) - (Number(s.adjustments) || 0)
          if (bal > 0.009) events.push({ key: 'sale-' + s.id, time: s.created_at, type: 'Credit sale', tone: 'red', title: `${s.customer_name} owes ${bal.toLocaleString()} UGX`, context: `Maya Branch · ${s.quantity} × ${s.item_label || 'item'} · total ${Number(s.total_amount).toLocaleString()} · paid ${Number(s.amount_paid).toLocaleString()}`, link: `/sales-report?customer=${encodeURIComponent(s.customer_name)}`, linkLabel: 'Open customer debt' })
        }
      })

      const { data: banks } = await supabase.from('bankings').select('*').order('created_at', { ascending: false }).limit(200)
      ;(banks || []).filter(b => systemUsers.has(b.recorded_by)).forEach(b => {
        if (b.status === 'pending') events.push({ key: 'bank-' + b.id, time: b.created_at, type: b.flagged ? 'Flagged banking' : 'Banking', tone: b.flagged ? 'red' : 'amber', title: b.flagged ? `${Number(b.amount_banked).toLocaleString()} UGX awaiting confirmation · variance ${Number(b.variance).toLocaleString()}` : `${Number(b.amount_banked).toLocaleString()} UGX awaiting confirmation`, context: `Maya Branch · ${b.bank_or_method || 'No method'} · banking date ${b.banking_date}`, link: `/cashbook?day=${b.banking_date}`, linkLabel: 'Open cash story' })
      })

      const { data: runs } = await supabase.from('production_log').select('*').order('created_at', { ascending: false }).limit(200)
      ;(runs || []).filter(r => rawIds.has(r.raw_material_id) || finishedIds.has(r.finished_good_id)).forEach(r => {
        if (Number(r.boss_expected_yield) !== Number(r.actual_yield)) events.push({ key: 'run-' + r.id, time: r.created_at, type: 'Production', tone: 'red', title: `Expected ${r.boss_expected_yield}, got ${r.actual_yield} · ${r.employee_name || 'staff'}`, context: `Maya Branch · raw units used ${r.raw_units_used ?? '—'} · scrap ${r.scrap_generated || 0} kg`, link: `/production-report?run=${r.id}`, linkLabel: 'Open production report' })
      })

      const { data: counts } = await supabase.from('stocktakes').select('*').order('count_date', { ascending: false }).limit(200)
      ;(counts || []).filter(c => c.item_type === 'raw' ? rawIds.has(c.item_id) : finishedIds.has(c.item_id)).forEach(c => {
        if (Number(c.difference) !== 0) events.push({ key: 'count-' + c.id, time: c.count_date, type: 'Stocktake', tone: 'red', title: `${c.item_label || 'Item'} difference ${Number(c.difference) > 0 ? '+' : ''}${c.difference}`, context: `Maya Branch · system ${c.system_quantity} vs physical ${c.physical_quantity}`, link: `/inventory/history?id=${c.item_id}&type=${c.item_type}`, linkLabel: 'Open item history' })
      })

      const { data: exps } = await supabase.from('expenses').select('*').order('created_at', { ascending: false }).limit(200)
      ;(exps || []).filter(e => systemUsers.has(e.recorded_by)).forEach(e => events.push({ key: 'exp-' + e.id, time: e.created_at, type: 'Expense', tone: 'amber', title: `${e.description} · ${Number(e.amount).toLocaleString()} UGX`, context: `Maya Branch · category ${e.category}`, link: `/cashbook?day=${toDayStr(new Date(e.created_at))}`, linkLabel: 'Open cash story' }))

      events.sort((a, b) => new Date(b.time) - new Date(a.time))
      setFeed(events.slice(0, 100)); setLoading(false)
    }
    load()
  }, [])

  if (!profile || loading) return <main className="page-wrap text-muted">Loading activity...</main>
  if (profile.role !== 'admin' && profile.role !== 'super_admin') return <main className="page-wrap"><div className="page-card max-w-md p-6"><h1 className="font-black">Management only</h1><p className="mt-2 text-sm text-muted">You do not have access to this page.</p></div></main>

  const now = new Date(), todayStr = toDayStr(now), yestStr = toDayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const byDay = {}; feed.forEach(e => { const day = toDayStr(new Date(e.time)); byDay[day] = byDay[day] || []; byDay[day].push(e) })
  const days = Object.keys(byDay).sort().reverse()
  const toneStyles = { red: 'bg-red-500/10 text-red-500 border-red-500/20', amber: 'bg-amber-500/10 text-amber-600 border-amber-500/20', blue: 'bg-[var(--accent-2)] text-accent border-[var(--line)]' }

  return <main className="page-wrap"><div className="page-header-row"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Activity & Alerts</h1><p className="page-subtitle">Only Maya Branch exceptions and business events.</p></div><div className="rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-black text-amber-500">{feed.length} events</div></div><div className="max-w-4xl space-y-7">{days.length === 0 && <div className="page-card p-8 text-center text-sm text-muted">No Maya Branch activity yet.</div>}{days.map(day => <section key={day}><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-black">{day === todayStr ? 'Today' : day === yestStr ? 'Yesterday' : day}</h2><span className="text-xs text-muted">{byDay[day].length} event{byDay[day].length === 1 ? '' : 's'}</span></div><div className="space-y-3">{byDay[day].map(e => <article key={e.key} className="page-card overflow-hidden"><button onClick={() => setExpanded(expanded === e.key ? null : e.key)} className="w-full px-4 py-4 text-left sm:px-5"><div className="flex items-start gap-3"><span className={`mt-0.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${toneStyles[e.tone] || toneStyles.blue}`}>{e.type}</span><div className="min-w-0 flex-1"><p className="font-black leading-6">{e.title}</p><p className="mt-1 text-xs text-muted">{new Date(e.time).toLocaleString()}</p></div><span className="text-muted">{expanded === e.key ? '−' : '+'}</span></div></button>{expanded === e.key && <div className="border-t border-[var(--line)] px-4 pb-4 pt-4 sm:px-5"><div className="surface-subtle rounded-2xl p-4 text-sm leading-6 text-muted">{e.context}</div><Link href={e.link} className="mt-3 inline-flex rounded-xl bg-amber-500 px-3.5 py-2.5 text-xs font-black text-slate-950">{e.linkLabel}</Link></div>}</article>)}</div></section>)}</div></main>
}
