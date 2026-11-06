'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { SYSTEM_BRANCH, isSystemBranch, getSystemRawIds, getSystemFinishedIds } from '../../lib/branch'
import { fetchRecipeBatches, batchLabel, batchNoteClass } from '../../lib/recipeBatches'
import StandardsHint from '../components/StandardsHint'

export default function ProductionPage() {
  const [profile, setProfile] = useState(null)
  const [recipes, setRecipes] = useState([])
  const [recipesLoaded, setRecipesLoaded] = useState(false)
  const [batches, setBatches] = useState([])
  const [batchNote, setBatchNote] = useState(null)
  const batchReq = useRef(0)
  const [recipeId, setRecipeId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [units, setUnits] = useState('')
  const [produced, setProduced] = useState('')
  const [scrap, setScrap] = useState('')
  const [saving, setSaving] = useState(false)
  const requestRef = useRef(null)
  const [message, setMessage] = useState(null)
  const messageRef = useRef(null)
  // The form is long, so on a phone the result appears above the screen: bring it into view.
  useEffect(() => { if (message) messageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [message])
  const [todayRuns, setTodayRuns] = useState([])
  const [fgMap, setFgMap] = useState({})

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
  const recipe = recipes.find(r => r.id === Number(recipeId))
  const batch = batches.find(b => b.id === Number(batchId))

  const loadToday = async () => {
    const rawIds = await getSystemRawIds(supabase)
    const fgIds = await getSystemFinishedIds(supabase)
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString()
    const { data } = await supabase.from('production_log').select('*').gte('created_at', start).order('created_at', { ascending: false })
    setTodayRuns((data || []).filter(r => rawIds.has(r.raw_material_id) || fgIds.has(r.finished_good_id)))
    const { data: fgs } = await supabase.from('finished_goods').select('id, name, gauge, size_dimensions, current_branch')
    setFgMap(Object.fromEntries((fgs || []).filter(f => isSystemBranch(f.current_branch)).map(f => [f.id, f])))
  }

  const loadBatches = async (rec) => {
    const req = ++batchReq.current
    setBatches([]); setBatchId(''); setBatchNote({ type: 'info', text: 'Loading stock…' })
    const { rows, note } = await fetchRecipeBatches(supabase, rec)
    if (req !== batchReq.current) return // a different standard was chosen while this loaded
    setBatches(rows); setBatchNote(note)
  }
  const clearBatches = () => { batchReq.current++; setBatches([]); setBatchId(''); setBatchNote(null) }

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return (window.location.href = '/login')
      const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
      setProfile(prof)
      const { data: recs } = await supabase.from('production_recipes').select('*').order('created_at', { ascending: false })
      setRecipes(recs || []); setRecipesLoaded(true)
      loadToday()
    }
    load()
  }, [])

  const expected = recipe && units ? Number(recipe.yield_per_raw_unit) * Number(units) : null

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setMessage(null)
    if (!recipe || !batch) { setMessage({ type: 'error', text: 'Choose a production standard and Maya Branch stock batch.' }); setSaving(false); return }
    const u = Number(units), p = Number(produced)
    if (![u,p].every(Number.isFinite) || u <= 0 || p <= 0 || !Number.isFinite(Number(scrap || 0)) || Number(scrap || 0) < 0) { setMessage({ type: 'error', text: 'Raw units and output must be positive, and scrap must not be negative.' }); setSaving(false); return }
    if (u > batch.quantity) { setMessage({ type: 'error', text: `Only ${batch.quantity} ${batch.unit} available at Maya Branch.` }); setSaving(false); return }

    const payload = { recipe_id: recipe.id, raw_id: batch.id, raw_units: u, quantity: p, scrap: Number(scrap) || 0 }
    const signature = JSON.stringify(payload)
    if (!requestRef.current || requestRef.current.signature !== signature) requestRef.current = { id: crypto.randomUUID(), signature }
    const { data: result, error } = await supabase.rpc('maya_ledger', {
      p_operation: 'production', p_data: payload,
      p_request_id: requestRef.current.id,
    })
    if (error) { setMessage({ type: 'error', text: error.message }); setSaving(false); return }
    requestRef.current = null

    // Show where the goods went: read the finished-goods line this run added to.
    let fg = null
    if (result?.finished_good_id) {
      const { data } = await supabase.from('finished_goods').select('name, gauge, size_dimensions, quantity, unit').eq('id', result.finished_good_id).maybeSingle()
      fg = data
    }
    const rawName = [batch.category, batch.gauge, batch.size_dimensions].filter(Boolean).join(' ')
    const fgName = fg ? [fg.name, fg.gauge, fg.size_dimensions].filter(Boolean).join(' ') : recipe.finished_name
    setMessage({
      type: 'success',
      text: `Recorded: used ${u} ${batch.unit} of ${rawName}, made ${p} pieces of ${fgName}. ${p} added to Finished Goods${fg ? ` — ${Number(fg.quantity).toLocaleString()} ${fg.unit} in stock now.` : '.'}`,
      links: [{ href: '/inventory?tab=finished', label: 'View in Finished Goods →' }, ...(result?.finished_good_id ? [{ href: `/inventory/history?id=${result.finished_good_id}&type=finished`, label: 'Lifecycle' }] : [])],
    })
    setUnits(''); setProduced(''); setScrap(''); loadToday(); loadBatches(recipe); setSaving(false)
  }

  if (!profile) return <main className="page-wrap text-muted">Loading production...</main>

  return <main className="page-wrap">
    <div className="page-header-row"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Production</h1><p className="page-subtitle">Materials and output for Maya Branch only.</p></div></div>
    {message && <div ref={messageRef} style={{ scrollMarginTop: '5.5rem' }} className={`mb-5 max-w-3xl rounded-xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-green-500/25 bg-green-500/10 text-green-500' : 'border-red-500/25 bg-red-500/10 text-red-500'}`}>{message.text}{message.links?.map(l => <Link key={l.href} href={l.href} className="ml-3 whitespace-nowrap font-black underline">{l.label}</Link>)}</div>}
    <div className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
      <form onSubmit={handleSubmit} className="page-card p-5 sm:p-6"><h2 className="page-section-title">New production run</h2><div className="space-y-4"><div><label className="mb-2 block text-sm font-bold">Production standard</label><select value={recipeId} onChange={(e) => { setRecipeId(e.target.value); const rec = recipes.find(r => r.id === Number(e.target.value)); if (rec) loadBatches(rec); else clearBatches() }} required className="input-base"><option value="">Select standard</option>{recipes.map(r => <option key={r.id} value={r.id}>{r.raw_category} {r.raw_gauge} → {r.finished_name} {r.finished_size || ''}</option>)}</select><StandardsHint loaded={recipesLoaded} count={recipes.length} isAdmin={isAdmin} /></div><div><label className="mb-2 block text-sm font-bold">Maya Branch stock batch</label><select value={batchId} onChange={(e) => setBatchId(e.target.value)} required disabled={!recipe} className="input-base"><option value="">{recipe ? 'Select batch' : 'Choose a production standard first'}</option>{batches.map(b => <option key={b.id} value={b.id}>{batchLabel(b)}</option>)}</select>{batchNote && <p className={`mt-2 text-xs ${batchNoteClass(batchNote)}`}>{batchNote.text}</p>}</div><div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-2 block text-sm font-bold">Raw units used</label><input type="number" step="0.001" value={units} onChange={(e) => setUnits(e.target.value)} required className="input-base" /></div><div><label className="mb-2 block text-sm font-bold">Pieces produced</label><input type="number" step="0.01" value={produced} onChange={(e) => setProduced(e.target.value)} required className="input-base" /></div></div><div><label className="mb-2 block text-sm font-bold">Scrap (kg)</label><input type="number" step="0.01" value={scrap} onChange={(e) => setScrap(e.target.value)} className="input-base" /></div>{expected !== null && <div className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm"><span className="text-muted">Expected output</span><strong className="ml-2 text-amber-500">{expected} pieces</strong></div>}<button type="submit" disabled={saving} className="w-full rounded-xl bg-amber-500 px-4 py-3.5 font-black text-slate-950 disabled:opacity-50">{saving ? 'Recording...' : 'Record production'}</button></div></form>
      <section><div className="mb-3 flex items-center justify-between"><h2 className="page-section-title mb-0">Today</h2><span className="text-xs text-muted">{todayRuns.length} Maya Branch run{todayRuns.length === 1 ? '' : 's'}</span></div><div className="space-y-3">{todayRuns.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No Maya Branch production recorded today.</div>}{todayRuns.map(r => { const fg = fgMap[r.finished_good_id]; const diff = Number(r.actual_yield) - Number(r.boss_expected_yield); return <article key={r.id} className="page-card p-4"><div className="flex items-start justify-between gap-4"><div><h3 className="font-black">{fg ? `${fg.name} ${fg.size_dimensions || ''}` : `Item #${r.finished_good_id}`}</h3><p className="mt-1 text-xs text-muted">{r.employee_name || 'Staff'} · {new Date(r.created_at).toLocaleTimeString()}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${diff === 0 ? 'bg-green-500/10 text-green-500' : diff < 0 ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'}`}>{diff === 0 ? 'ON STANDARD' : diff < 0 ? `${diff} BELOW` : `+${diff} ABOVE`}</span></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="surface-subtle rounded-xl p-3"><p className="text-[10px] text-muted">USED</p><p className="mt-1 font-black">{r.raw_units_used}</p></div><div className="surface-subtle rounded-xl p-3"><p className="text-[10px] text-muted">EXPECTED</p><p className="mt-1 font-black">{r.boss_expected_yield}</p></div><div className="surface-subtle rounded-xl p-3"><p className="text-[10px] text-muted">MADE</p><p className="mt-1 font-black">{r.actual_yield}</p></div></div></article>})}</div></section>
    </div>
  </main>
}
