'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

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
      if (!session) {
        window.location.href = '/login'
        return
      }
      const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
      setProfile(prof)
      if (!(prof?.role === 'admin' || prof?.role === 'super_admin')) {
        setLoading(false)
        return
      }

      const { data: r } = await supabase.from('production_log').select('*').order('created_at', { ascending: false }).limit(200)
      setRuns(r || [])

      const { data: fgs } = await supabase.from('finished_goods').select('id, name, gauge, size_dimensions')
      setFgMap(Object.fromEntries((fgs || []).map(f => [f.id, f])))

      const { data: raws } = await supabase.from('raw_materials_admin_view').select('id, category, gauge, size_dimensions')
      setRawMap(Object.fromEntries((raws || []).map(x => [x.id, x])))

      const params = new URLSearchParams(window.location.search)
      const runId = params.get('run')
      if (runId) setExpandedRun(Number(runId))

      setLoading(false)
    }
    load()
  }, [])

  if (!profile) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
    return (
      <main className="min-h-screen bg-slate-900 p-6">
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
        <div className="bg-slate-800 rounded-xl p-6 max-w-md mt-8">
          <p className="text-white font-bold">🔒 Boss eyes only</p>
        </div>
      </main>
    )
  }

  if (loading) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  const flagged = runs.filter(r => Number(r.boss_expected_yield) !== Number(r.actual_yield))
  const lost = runs.reduce((s, r) => s + (Number(r.actual_yield) - Number(r.boss_expected_yield)), 0)

  const byDay = {}
  runs.forEach(r => {
    const day = toDayStr(new Date(r.created_at))
    byDay[day] = byDay[day] || []
    byDay[day].push(r)
  })
  const days = Object.keys(byDay).sort().reverse()

  const now = new Date()
  const todayStr = toDayStr(now)
  const yestStr = toDayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">📊 Production Report</h1>
          <p className="text-slate-400 text-sm">Grouped by day — tap any run for the full story behind the flag</p>
        </div>
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
      </header>

      <div className="grid grid-cols-3 gap-3 max-w-3xl mb-8">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase">Total runs</p>
          <p className="text-xl font-black text-white mt-1">{runs.length}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-red-500/40">
          <p className="text-xs text-slate-400 uppercase">Flagged runs</p>
          <p className="text-xl font-black text-red-400 mt-1">{flagged.length}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-red-500/40">
          <p className="text-xs text-slate-400 uppercase">Net pieces lost</p>
          <p className="text-xl font-black text-red-400 mt-1">{lost}</p>
        </div>
      </div>

      <div className="max-w-3xl space-y-8">
        {days.length === 0 && <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500">No production runs yet.</div>}
        {days.map(day => (
          <div key={day}>
            <h3 className="text-sm font-black text-amber-400 uppercase tracking-wide mb-3">
              {day === todayStr ? '📍 Today' : day === yestStr ? '📍 Yesterday' : `📅 ${day}`}
            </h3>
            <div className="space-y-3">
              {byDay[day].map(r => {
                const fg = fgMap[r.finished_good_id]
                const raw = rawMap[r.raw_material_id]
                const diff = Number(r.actual_yield) - Number(r.boss_expected_yield)
                const eff = r.boss_expected_yield > 0 ? Math.round((Number(r.actual_yield) / Number(r.boss_expected_yield)) * 100) : 0
                const isOpen = expandedRun === r.id
                return (
                  <div key={r.id} className={`rounded-xl border ${diff !== 0 ? 'border-red-500/40 bg-red-900/10' : 'border-slate-700 bg-slate-800'}`}>
                    <button onClick={() => setExpandedRun(isOpen ? null : r.id)} className="w-full text-left p-4">
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-white text-sm">
                          {fg ? `${fg.name} ${fg.gauge || ''} ${fg.size_dimensions || ''}` : `#${r.finished_good_id}`}
                        </p>
                        <span className={`text-xs font-bold px-2 py-1 rounded ${diff === 0 ? 'bg-green-500/20 text-green-300' : diff < 0 ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`}>
                          {diff === 0 ? 'ON STANDARD' : diff < 0 ? `LOSS ${diff}` : `OVER +${diff}`}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-2">
                        {r.employee_name || 'staff'} · expected {r.boss_expected_yield} · made {r.actual_yield} · {eff}% · {isOpen ? 'collapse ▲' : 'why? tap ▼'}
                      </p>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 space-y-3">
                        <div className="bg-slate-900/60 rounded-lg p-3 text-xs text-slate-300 space-y-1">
                          <p>🏭 <span className="text-white font-bold">What was made:</span> {fg ? `${fg.name} ${fg.gauge || ''} ${fg.size_dimensions || ''}` : '—'} → {r.actual_yield} pieces</p>
                          <p> <span className="text-white font-bold">Cut from:</span> {raw ? `${raw.category} ${raw.gauge || ''} ${raw.size_dimensions || ''}` : '—'} · {r.raw_units_used} unit(s) used</p>
                          <p>🎯 <span className="text-white font-bold">Boss standard expected:</span> {r.boss_expected_yield} pieces · efficiency {eff}%</p>
                          <p>🗑️ <span className="text-white font-bold">Scrap:</span> {r.scrap_generated || 0} kg</p>
                          <p>👷 <span className="text-white font-bold">Ran by:</span> {r.employee_name || '—'} · {new Date(r.created_at).toLocaleString()}</p>
                          {diff !== 0 && (
                            <p className={diff < 0 ? 'text-red-400 font-bold' : 'text-amber-400 font-bold'}>
                              {diff < 0 ? `⚠️ ${Math.abs(diff)} piece(s) unaccounted — investigate with ${r.employee_name || 'the team'}.` : `⚠️ +${diff} pieces OVER standard — check the recipe or the count.`}
                            </p>
                          )}
                        </div>
                        {raw && (
                          <Link href={`/inventory/history?id=${raw.id}&type=raw`}
                            className="inline-block text-xs font-bold bg-amber-500 text-slate-900 px-3 py-2 rounded-lg hover:bg-amber-400">
                            → Open the raw batch lifecycle
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}