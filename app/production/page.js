'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
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
      if (!session) {
        window.location.href = '/login'
        return
      }
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

    if (!recipe || !batch) {
      setMessage({ type: 'error', text: 'Choose a standard and a stock batch.' })
      setSaving(false)
      return
    }
    const u = Number(units)
    const p = Number(produced)
    if (!u || !p) {
      setMessage({ type: 'error', text: 'Fill in units used and pieces produced.' })
      setSaving(false)
      return
    }
    if (u > batch.quantity) {
      setMessage({ type: 'error', text: `Only ${batch.quantity} ${batch.unit} available in that batch.` })
      setSaving(false)
      return
    }

    let fg = null
    const { data: existing } = await supabase.from('finished_goods').select('*').ilike('name', recipe.finished_name).limit(1)
    if (existing && existing.length > 0) {
      fg = existing[0]
    } else {
      const { data: created, error: fgErr } = await supabase
        .from('finished_goods')
        .insert({ name: recipe.finished_name, gauge: recipe.raw_gauge, size_dimensions: recipe.finished_size, unit: 'pieces', quantity: 0, selling_price: 0 })
        .select().single()
      if (fgErr) { setMessage({ type: 'error', text: fgErr.message }); setSaving(false); return }
      fg = created
    }

    const exp = Number(recipe.yield_per_raw_unit) * u

    const { error: logErr } = await supabase.from('production_log').insert({
      finished_good_id: fg.id,
      boss_expected_yield: exp,
      actual_yield: p,
      raw_material_id: batch.id,
      fraction_of_material_used: u / batch.quantity,
      raw_units_used: u,
      scrap_generated: Number(scrap) || 0,
      employee_name: profile?.full_name
    })
    if (logErr) { setMessage({ type: 'error', text: logErr.message }); setSaving(false); return }

    const { error: d1 } = await supabase.rpc('deduct_stock', {
      p_item_type: 'raw', p_item_id: batch.id, p_quantity: u,
      p_movement_type: 'used_in_production', p_notes: `Production: ${recipe.finished_name}`
    })
    if (d1) { setMessage({ type: 'error', text: d1.message }); setSaving(false); return }

    const { error: a1 } = await supabase.rpc('add_stock', {
      p_item_type: 'finished', p_item_id: fg.id, p_quantity: p,
      p_movement_type: 'produced', p_notes: `Produced by ${profile?.full_name}`
    })
    if (a1) { setMessage({ type: 'error', text: a1.message }); setSaving(false); return }

    setMessage({ type: 'success', text: `Production recorded: ${p} pieces of ${recipe.finished_name} (expected ${exp}).` })
    setUnits(''); setProduced(''); setScrap('')
    loadToday()
    setSaving(false)
  }

  if (!profile) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">🏭 Record Production</h1>
          <p className="text-slate-400 text-sm">Pick the boss's standard, count what you used and made — that's all</p>
        </div>
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
      </header>

      {message && (
        <div className={`mb-4 max-w-2xl rounded-lg p-3 text-sm ${message.type === 'success' ? 'bg-green-900/50 text-green-200 border border-green-700' : 'bg-red-900/50 text-red-200 border border-red-700'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-slate-800 rounded-xl p-6 space-y-5 max-w-2xl mb-10">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">1. Choose Production Standard *</label>
          <select value={recipeId} onChange={(e) => { setRecipeId(e.target.value); const rec = recipes.find(r => r.id === Number(e.target.value)); if (rec) loadBatches(rec) }} required
            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2">
            <option value="">-- Select standard --</option>
            {recipes.map(r => (
              <option key={r.id} value={r.id}>
                {r.raw_category} {r.raw_gauge} → {r.finished_name} {r.finished_size || ''} ({r.yield_per_raw_unit} per {r.raw_unit === 'kg' ? 'kg' : 'piece'})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">2. Stock batch to cut from *</label>
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)} required
            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2">
            <option value="">-- Select batch --</option>
            {batches.map(b => (
              <option key={b.id} value={b.id}>Received {new Date(b.created_at).toLocaleDateString()} — {b.quantity} {b.unit} available</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">3. Raw units used *</label>
            <input type="number" step="0.001" value={units} onChange={(e) => setUnits(e.target.value)} required
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2" placeholder="e.g. 2.5 (plates)" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">4. Actual pieces produced *</label>
            <input type="number" step="0.01" value={produced} onChange={(e) => setProduced(e.target.value)} required
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2" placeholder="e.g. 53" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Scrap (kg) — optional</label>
          <input type="number" step="0.01" value={scrap} onChange={(e) => setScrap(e.target.value)}
            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2" placeholder="e.g. 2.5" />
        </div>

        {expected !== null && (
          <p className="text-xs text-slate-400">Boss's standard expects <span className="font-bold text-amber-400">{expected}</span> pieces from {units} unit(s).</p>
        )}

        <button type="submit" disabled={saving}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-bold text-sm py-3 rounded-lg">
          {saving ? 'Recording...' : 'Record Production'}
        </button>
      </form>

      <h2 className="text-lg font-bold text-white mb-3">🏭 Today's Production</h2>
      <div className="space-y-3 max-w-2xl">
        {todayRuns.length === 0 && (
          <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500">No production recorded yet today.</div>
        )}
        {todayRuns.map(r => {
          const fg = fgMap[r.finished_good_id]
          const diff = Number(r.actual_yield) - Number(r.boss_expected_yield)
          return (
            <div key={r.id} className="bg-slate-800 rounded-xl border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="font-bold text-white">{fg ? `${fg.name} ${fg.size_dimensions || ''}` : `#${r.finished_good_id}`}</p>
                <span className={`text-xs font-bold px-2 py-1 rounded ${diff === 0 ? 'bg-green-500/20 text-green-300' : diff < 0 ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`}>
                  {diff === 0 ? 'ON STANDARD' : diff < 0 ? `LOSS ${diff}` : `OVER +${diff}`}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {r.employee_name || 'staff'} · used {r.raw_units_used} units · expected {r.boss_expected_yield} · made <span className="font-bold text-white">{r.actual_yield}</span> · scrap {r.scrap_generated || 0} kg
              </p>
              <p className="text-[10px] text-slate-500 mt-1">{new Date(r.created_at).toLocaleTimeString()}</p>
            </div>
          )
        })}
      </div>
    </main>
  )
}