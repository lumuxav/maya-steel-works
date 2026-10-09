'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SYSTEM_BRANCH, getSystemUserIds, getSystemRawIds, getSystemFinishedIds } from '../../lib/branch'

const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const TABS = [
  { key: 'counts', label: 'Count differences' },
  { key: 'bankings', label: 'Banking variances' },
  { key: 'production', label: 'Production losses' },
  { key: 'credit', label: 'Credit sales' },
  { key: 'corrections', label: 'Corrections' }
]

export default function RecordsPage() {
  const [profile, setProfile] = useState(null)
  const [tab, setTab] = useState('counts')
  const [counts, setCounts] = useState([])
  const [bankings, setBankings] = useState([])
  const [runs, setRuns] = useState([])
  const [sales, setSales] = useState([])
  const [corrections, setCorrections] = useState([])
  const [userMap, setUserMap] = useState({})
  const [fgMap, setFgMap] = useState({})
  const [loading, setLoading] = useState(true)

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return (window.location.href = '/login')
      const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
      setProfile(prof)
      if (!(prof?.role === 'admin' || prof?.role === 'super_admin')) { setLoading(false); return }

      const systemUsers = await getSystemUserIds(supabase)
      const rawIds = await getSystemRawIds(supabase)
      const fgIds = await getSystemFinishedIds(supabase)
      const [c,b,r,s,co,u,f] = await Promise.all([
        supabase.from('stocktakes').select('*').neq('difference', 0).order('count_date', { ascending: false }).limit(300),
        supabase.from('bankings').select('*').neq('variance', 0).order('created_at', { ascending: false }).limit(300),
        supabase.from('production_log').select('*').order('created_at', { ascending: false }).limit(300),
        supabase.from('sales').select('*').neq('payment_status', 'paid').order('created_at', { ascending: false }).limit(300),
        supabase.from('corrections_log').select('*').order('changed_at', { ascending: false }).limit(300),
        supabase.from('users').select('id, full_name, branch'),
        supabase.from('finished_goods').select('id, name, gauge, size_dimensions, current_branch')
      ])
      setCounts((c.data || []).filter(x => x.item_type === 'raw' ? rawIds.has(x.item_id) : fgIds.has(x.item_id)))
      setBankings((b.data || []).filter(x => systemUsers.has(x.recorded_by)))
      setRuns((r.data || []).filter(x => (rawIds.has(x.raw_material_id) || fgIds.has(x.finished_good_id)) && Number(x.boss_expected_yield) !== Number(x.actual_yield)))
      setSales((s.data || []).filter(x => systemUsers.has(x.sold_by)))
      setCorrections((co.data || []).filter(x => !x.changed_by || systemUsers.has(x.changed_by)))
      setUserMap(Object.fromEntries((u.data || []).filter(x => systemUsers.has(x.id)).map(x => [x.id, x])))
      setFgMap(Object.fromEntries((f.data || []).filter(x => fgIds.has(x.id)).map(x => [x.id, x])))
      setLoading(false)
    }
    load()
  }, [])

  if (!profile || loading) return <main className="page-wrap text-muted">Loading records...</main>
  if (!isAdmin) return <main className="page-wrap"><div className="page-card max-w-md p-6"><h1 className="font-black">Management only</h1></div></main>

  const nameOf = (id) => userMap[id]?.full_name || '—'
  const datasets = {
    counts: counts.map(c => ({ time: c.count_date, title: `${c.item_label || `#${c.item_id}`} — difference ${Number(c.difference) > 0 ? '+' : ''}${c.difference}`, meta: `System ${c.system_quantity} vs physical ${c.physical_quantity} · counted by ${c.counter_name || nameOf(c.counted_by)}` })),
    bankings: bankings.map(b => ({ time: b.created_at, title: `Banking ${Number(b.amount_banked).toLocaleString()} UGX — variance ${Number(b.variance).toLocaleString()}`, meta: `Expected ${Number(b.expected_amount || 0).toLocaleString()} · ${b.bank_or_method || 'no method'} · ${b.banking_date} · ${nameOf(b.recorded_by)}` })),
    production: runs.map(r => ({ time: r.created_at, title: `${fgMap[r.finished_good_id] ? `${fgMap[r.finished_good_id].name} ${fgMap[r.finished_good_id].size_dimensions || ''}` : `#${r.finished_good_id}`} — expected ${r.boss_expected_yield}, got ${r.actual_yield}`, meta: `Difference ${Number(r.actual_yield) - Number(r.boss_expected_yield)} · raw units ${r.raw_units_used} · ${r.employee_name || '—'}` })),
    credit: sales.map(s => ({ time: s.created_at, title: `${s.customer_name} — ${s.item_label || 'item'} × ${s.quantity}`, meta: `Total ${Number(s.total_amount).toLocaleString()} · paid ${Number(s.amount_paid).toLocaleString()} · ${s.payment_status} · ${nameOf(s.sold_by)}` })),
    corrections: corrections.map(c => ({ time: c.changed_at, title: `${c.table_name} #${c.row_id} — ${c.field_name}`, meta: `${c.new_value === 'DELETED' ? `Deleted (${c.old_value})` : `${c.old_value} → ${c.new_value}`} · ${nameOf(c.changed_by)} · ${c.reason || 'No reason'}` }))
  }
  const rows = datasets[tab] || []
  const byDay = {}; rows.forEach(r => { const day = toDayStr(new Date(r.time)); byDay[day] = byDay[day] || []; byDay[day].push(r) })
  const days = Object.keys(byDay).sort().reverse()

  return <main className="page-wrap"><div className="page-header-row"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Records & Discrepancies</h1><p className="page-subtitle">Permanent records for Maya Branch only.</p></div></div><div className="maya-records-tabs mb-6 max-w-4xl" role="tablist" aria-label="Record category">{TABS.map(t => <button key={t.key} id={`maya-records-tab-${t.key}`} type="button" role="tab" aria-selected={tab === t.key} aria-controls="maya-records-panel" onClick={() => setTab(t.key)} className={`maya-records-tab rounded-xl border px-3 py-3 text-sm font-bold ${tab === t.key ? 'border-amber-500 bg-amber-500 text-slate-950' : 'border-[var(--line)] text-muted'}`}>{t.label}</button>)}</div><div id="maya-records-panel" className="max-w-3xl space-y-8" role="tabpanel" aria-labelledby={`maya-records-tab-${tab}`}>{days.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">Nothing recorded here yet.</div>}{days.map(day => <div key={day}><h3 className="mb-2 text-sm font-black text-amber-500">{day} · {byDay[day].length} record(s)</h3><div className="space-y-3">{byDay[day].map((r,i) => <div key={i} className="page-card p-4"><p className="font-black">{r.title}</p><p className="mt-1 text-sm text-muted">{r.meta}</p><p className="mt-2 text-xs text-muted">{new Date(r.time).toLocaleString()}</p></div>)}</div></div>)}</div></main>
}
