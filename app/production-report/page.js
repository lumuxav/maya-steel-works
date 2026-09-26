'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { SYSTEM_BRANCH, getSystemRawIds, getSystemFinishedIds, isSystemBranch } from '../../lib/branch'

const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function ProductionReportPage() {
  const [profile, setProfile] = useState(null)
  const [runs, setRuns] = useState([])
  const [fgMap, setFgMap] = useState({})
  const [rawMap, setRawMap] = useState({})
  const [expandedRun, setExpandedRun] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return (window.location.href = '/login')
      const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
      setProfile(prof)
      if (!(prof?.role === 'admin' || prof?.role === 'super_admin')) { setLoading(false); return }

      const rawIds = await getSystemRawIds(supabase)
      const fgIds = await getSystemFinishedIds(supabase)
      const { data: r } = await supabase.from('production_log').select('*').order('created_at', { ascending: false }).limit(300)
      setRuns((r || []).filter(x => rawIds.has(x.raw_material_id) || fgIds.has(x.finished_good_id)))

      const { data: fgs } = await supabase.from('finished_goods').select('id, name, gauge, size_dimensions, current_branch')
      setFgMap(Object.fromEntries((fgs || []).filter(f => isSystemBranch(f.current_branch)).map(f => [f.id, f])))
      const { data: raws } = await supabase.from('raw_materials_admin_view').select('id, category, gauge, size_dimensions, current_branch')
      setRawMap(Object.fromEntries((raws || []).filter(x => isSystemBranch(x.current_branch)).map(x => [x.id, x])))

      const runId = new URLSearchParams(window.location.search).get('run')
      if (runId) setExpandedRun(Number(runId))
      setLoading(false)
    }
    load()
  }, [])

  if (!profile || loading) return <main className="page-wrap text-muted">Loading report...</main>
  if (profile.role !== 'admin' && profile.role !== 'super_admin') return <main className="page-wrap"><div className="page-card max-w-md p-6"><p className="font-black">Management only</p></div></main>

  const flagged = runs.filter(r => Number(r.boss_expected_yield) !== Number(r.actual_yield))
  const net = runs.reduce((s, r) => s + (Number(r.actual_yield) - Number(r.boss_expected_yield)), 0)
  const byDay = {}; runs.forEach(r => { const day = toDayStr(new Date(r.created_at)); byDay[day] = byDay[day] || []; byDay[day].push(r) })
  const days = Object.keys(byDay).sort().reverse()
  const now = new Date(), todayStr = toDayStr(now), yestStr = toDayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))

  return <main className="page-wrap"><div className="page-header-row"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Production Report</h1><p className="page-subtitle">Maya Branch production only.</p></div><Link href="/production" className="btn-secondary rounded-xl px-3 py-2 text-sm font-bold">Production</Link></div>
    <div className="mb-8 grid max-w-3xl grid-cols-3 gap-3"><div className="page-card p-4"><p className="text-xs text-muted">Total runs</p><p className="mt-1 text-xl font-black">{runs.length}</p></div><div className="page-card p-4"><p className="text-xs text-muted">Flagged runs</p><p className="mt-1 text-xl font-black text-red-500">{flagged.length}</p></div><div className="page-card p-4"><p className="text-xs text-muted">Net variance</p><p className={`mt-1 text-xl font-black ${net < 0 ? 'text-red-500' : 'text-amber-500'}`}>{net > 0 ? '+' : ''}{net}</p></div></div>
    <div className="max-w-3xl space-y-8">{days.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No Maya Branch production runs yet.</div>}{days.map(day => <div key={day}><h3 className="mb-3 text-sm font-black text-amber-500">{day === todayStr ? 'Today' : day === yestStr ? 'Yesterday' : day}</h3><div className="space-y-3">{byDay[day].map(r => { const fg = fgMap[r.finished_good_id], raw = rawMap[r.raw_material_id], diff = Number(r.actual_yield) - Number(r.boss_expected_yield), eff = Number(r.boss_expected_yield) > 0 ? Math.round(Number(r.actual_yield)/Number(r.boss_expected_yield)*100) : 0, open = expandedRun === r.id; return <div key={r.id} className={`page-card overflow-hidden ${diff !== 0 ? 'border-red-500/30' : ''}`}><button onClick={() => setExpandedRun(open ? null : r.id)} className="w-full p-4 text-left"><div className="flex items-center justify-between gap-3"><p className="font-black">{fg ? `${fg.name} ${fg.gauge || ''} ${fg.size_dimensions || ''}` : `#${r.finished_good_id}`}</p><span className={`rounded-lg px-2 py-1 text-xs font-black ${diff === 0 ? 'bg-green-500/10 text-green-500' : diff < 0 ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'}`}>{diff === 0 ? 'ON STANDARD' : `${diff > 0 ? '+' : ''}${diff}`}</span></div><p className="mt-2 text-xs text-muted">{r.employee_name || 'staff'} · expected {r.boss_expected_yield} · made {r.actual_yield} · {eff}%</p></button>{open && <div className="border-t border-[var(--line)] p-4"><div className="surface-subtle rounded-xl p-3 text-sm text-muted"><p>Made: {fg ? fg.name : '—'} — {r.actual_yield} pieces</p><p className="mt-1">Cut from: {raw ? `${raw.category} ${raw.gauge || ''} ${raw.size_dimensions || ''}` : '—'} · {r.raw_units_used} unit(s)</p><p className="mt-1">Scrap: {r.scrap_generated || 0} kg</p></div>{raw && <Link href={`/inventory/history?id=${raw.id}&type=raw`} className="mt-3 inline-block rounded-lg bg-amber-500 px-3 py-2 text-xs font-black text-slate-950">Open raw batch lifecycle</Link>}</div>}</div>})}</div></div>)}</div>
  </main>
}
