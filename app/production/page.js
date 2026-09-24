'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function ProductionPage() {
  const [profile, setProfile] = useState(null)
  const [recipes, setRecipes] = useState([])
  const [batches, setBatches] = useState([])
  const [recipeId, setRecipeId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [units, setUnits] = useState('')
  const [produced, setProduced] = useState('')
  const [scrap, setScrap] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [todayRuns, setTodayRuns] = useState([])
  const [fgMap, setFgMap] = useState({})

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
  const recipe = recipes.find(r => r.id === Number(recipeId))
  const batch = batches.find(b => b.id === Number(batchId))

  const loadToday = async () => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const { data } = await supabase.from('production_log').select('*').gte('created_at', start).order('created_at', { ascending: false })
    setTodayRuns(data || [])
    const { data: fgs } = await supabase.from('finished_goods').select('id, name, gauge, size_dimensions')
    setFgMap(Object.fromEntries((fgs || []).map(f => [f.id, f])))
  }

  const loadBatches = async (rec) => {
    const source = isAdmin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'
    const { data } = await supabase.from(source).select('*').ilike('category', rec.raw_category).gt('quantity', 0).order('created_at', { ascending: true })
    let rows = data || []
    if (rec.raw_gauge) rows = rows.filter(r => (r.gauge || '').toLowerCase().includes(rec.raw_gauge.toLowerCase()))
    if (rec.raw_size) rows = rows.filter(r => (r.size_dimensions || '').toLowerCase().includes(rec.raw_size.toLowerCase()))
    setBatches(rows)
    setBatchId('')
  }

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { window.location.href = '/login'; return }
      const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
      setProfile(prof)
      const { data: recs } = await supabase.from('production_recipes').select('*').order('created_at', { ascending: false })
      setRecipes(recs || [])
      loadToday()
    }
    load()
  }, [])

  const expected = recipe && units ? Number(recipe.yield_per_raw_unit) * Number(units) : null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    if (!recipe || !batch) { setMessage({ type: 'error', text: 'Choose a production standard and stock batch.' }); setSaving(false); return }
    const u = Number(units)
    const p = Number(produced)
    if (!u || !p) { setMessage({ type: 'error', text: 'Enter raw units used and pieces produced.' }); setSaving(false); return }
    if (u > batch.quantity) { setMessage({ type: 'error', text: `Only ${batch.quantity} ${batch.unit} available in this batch.` }); setSaving(false); return }

    let fg = null
    const { data: existing } = await supabase.from('finished_goods').select('*').ilike('name', recipe.finished_name).limit(1)
    if (existing && existing.length > 0) fg = existing[0]
    else {
      const { data: created, error: fgErr } = await supabase.from('finished_goods').insert({ name: recipe.finished_name, gauge: recipe.raw_gauge, size_dimensions: recipe.finished_size, unit: 'pieces', quantity: 0, selling_price: 0 }).select().single()
      if (fgErr) { setMessage({ type: 'error', text: fgErr.message }); setSaving(false); return }
      fg = created
    }

    const exp = Number(recipe.yield_per_raw_unit) * u
    const { error: logErr } = await supabase.from('production_log').insert({ finished_good_id: fg.id, boss_expected_yield: exp, actual_yield: p, raw_material_id: batch.id, fraction_of_material_used: u / batch.quantity, raw_units_used: u, scrap_generated: Number(scrap) || 0, employee_name: profile?.full_name })
    if (logErr) { setMessage({ type: 'error', text: logErr.message }); setSaving(false); return }

    const { error: d1 } = await supabase.rpc('deduct_stock', { p_item_type: 'raw', p_item_id: batch.id, p_quantity: u, p_movement_type: 'used_in_production', p_notes: `Production: ${recipe.finished_name}` })
    if (d1) { setMessage({ type: 'error', text: d1.message }); setSaving(false); return }
    const { error: a1 } = await supabase.rpc('add_stock', { p_item_type: 'finished', p_item_id: fg.id, p_quantity: p, p_movement_type: 'produced', p_notes: `Produced by ${profile?.full_name}` })
    if (a1) { setMessage({ type: 'error', text: a1.message }); setSaving(false); return }

    setMessage({ type: 'success', text: `Production recorded: ${p} pieces of ${recipe.finished_name}.` })
    setUnits(''); setProduced(''); setScrap('')
    loadToday()
    setSaving(false)
  }

  if (!profile) return <main className="page-wrap text-muted">Loading production...</main>

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Operations</p>
          <h1 className="page-title">Production</h1>
          <p className="page-subtitle">Record materials used, output made and production variance.</p>
        </div>
      </div>

      {message && <div className={`mb-5 max-w-3xl rounded-2xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500' : 'border-red-500/25 bg-red-500/10 text-red-500'}`}>{message.text}</div>}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
        <form onSubmit={handleSubmit} className="page-card p-5 sm:p-6">
          <h2 className="page-section-title">New production run</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-bold">Production standard</label>
              <select value={recipeId} onChange={(e) => { setRecipeId(e.target.value); const rec = recipes.find(r => r.id === Number(e.target.value)); if (rec) loadBatches(rec) }} required className="input-base">
                <option value="">Select standard</option>
                {recipes.map(r => <option key={r.id} value={r.id}>{r.raw_category} {r.raw_gauge} → {r.finished_name} {r.finished_size || ''}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold">Stock batch</label>
              <select value={batchId} onChange={(e) => setBatchId(e.target.value)} required className="input-base">
                <option value="">Select batch</option>
                {batches.map(b => <option key={b.id} value={b.id}>{new Date(b.created_at).toLocaleDateString()} · {b.quantity} {b.unit} available</option>)}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="mb-2 block text-sm font-bold">Raw units used</label><input type="number" step="0.001" value={units} onChange={(e) => setUnits(e.target.value)} required className="input-base" placeholder="0" /></div>
              <div><label className="mb-2 block text-sm font-bold">Pieces produced</label><input type="number" step="0.01" value={produced} onChange={(e) => setProduced(e.target.value)} required className="input-base" placeholder="0" /></div>
            </div>
            <div><label className="mb-2 block text-sm font-bold">Scrap (kg)</label><input type="number" step="0.01" value={scrap} onChange={(e) => setScrap(e.target.value)} className="input-base" placeholder="Optional" /></div>
            {expected !== null && <div className="rounded-2xl bg-[var(--accent-2)] px-4 py-3 text-sm"><span className="text-muted">Expected output</span><strong className="ml-2 text-accent">{expected} pieces</strong></div>}
            <button type="submit" disabled={saving} className="btn-primary w-full rounded-2xl px-4 py-3.5 font-black disabled:opacity-50">{saving ? 'Recording...' : 'Record production'}</button>
          </div>
        </form>

        <section>
          <div className="mb-3 flex items-center justify-between"><h2 className="page-section-title mb-0">Today</h2><span className="text-xs text-muted">{todayRuns.length} run{todayRuns.length === 1 ? '' : 's'}</span></div>
          <div className="space-y-3">
            {todayRuns.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No production recorded today.</div>}
            {todayRuns.map(r => {
              const fg = fgMap[r.finished_good_id]
              const diff = Number(r.actual_yield) - Number(r.boss_expected_yield)
              return (
                <article key={r.id} className="page-card p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div><h3 className="font-black">{fg ? `${fg.name} ${fg.size_dimensions || ''}` : `Item #${r.finished_good_id}`}</h3><p className="mt-1 text-xs text-muted">{r.employee_name || 'Staff'} · {new Date(r.created_at).toLocaleTimeString()}</p></div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${diff === 0 ? 'bg-emerald-500/10 text-emerald-500' : diff < 0 ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'}`}>{diff === 0 ? 'ON STANDARD' : diff < 0 ? `${diff} BELOW` : `+${diff} ABOVE`}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="surface-subtle rounded-xl p-3"><p className="text-[10px] text-muted">USED</p><p className="mt-1 font-black">{r.raw_units_used}</p></div>
                    <div className="surface-subtle rounded-xl p-3"><p className="text-[10px] text-muted">EXPECTED</p><p className="mt-1 font-black">{r.boss_expected_yield}</p></div>
                    <div className="surface-subtle rounded-xl p-3"><p className="text-[10px] text-muted">MADE</p><p className="mt-1 font-black">{r.actual_yield}</p></div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
