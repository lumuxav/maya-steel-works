'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

const emptyForm = {
  raw_category: '',
  raw_gauge: '',
  raw_size: '',
  raw_unit: 'pieces',
  finished_name: '',
  finished_size: '',
  yield_per_raw_unit: '',
  notes: ''
}

export default function RecipesPage() {
  const [profile, setProfile] = useState(null)
  const [recipes, setRecipes] = useState([])
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  const loadRecipes = async () => {
    const { data } = await supabase
      .from('production_recipes')
      .select('*')
      .order('created_at', { ascending: false })
    setRecipes(data || [])
  }

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
      loadRecipes()
    }
    load()
  }, [])

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  const updateForm = (field, value) => setForm(prev => ({ ...prev, [field]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    const { data: { session } } = await supabase.auth.getSession()

    const { error } = await supabase.from('production_recipes').insert({
      raw_category: form.raw_category.trim(),
      raw_gauge: form.raw_gauge.trim() || null,
      raw_size: form.raw_size.trim() || null,
      raw_unit: form.raw_unit,
      finished_name: form.finished_name.trim(),
      finished_size: form.finished_size.trim() || null,
      yield_per_raw_unit: Number(form.yield_per_raw_unit),
      notes: form.notes.trim() || null,
      created_by: session.user.id
    })

    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setMessage({ type: 'success', text: 'Standard saved! Staff now see it in the Production screen.' })
      setForm({ ...emptyForm })
      loadRecipes()
    }
    setSaving(false)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this standard?')) return
    await supabase.from('production_recipes').delete().eq('id', id)
    loadRecipes()
  }

  if (!profile) {
    return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-slate-900 p-6">
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">
          ← Back to Dashboard
        </Link>
        <div className="bg-slate-800 rounded-xl p-6 max-w-md mt-8">
          <p className="text-white font-bold">🔒 Admin only</p>
          <p className="text-slate-400 text-sm mt-2">
            Production standards are set by the boss. Your Production screen already uses them automatically.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-900 p-6">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-white">⚙️ Production Standards</h1>
          <p className="text-slate-400 text-sm">Define yields ONCE — staff never re-type them again</p>
        </div>
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">
          ← Back to Dashboard
        </Link>
      </header>

      {message && (
        <div className={`mb-4 max-w-4xl rounded-lg p-3 text-sm ${
          message.type === 'success'
            ? 'bg-green-900/50 text-green-200 border border-green-700'
            : 'bg-red-900/50 text-red-200 border border-red-700'
        }`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-slate-800 rounded-xl p-6 space-y-4 max-w-4xl mb-8">
        <h2 className="font-bold text-white">Add New Standard</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Raw Category *</label>
            <input value={form.raw_category} onChange={(e) => updateForm('raw_category', e.target.value)} required
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-2 py-1.5 text-sm"
              placeholder="e.g. plain (as typed in stock)" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Raw Gauge *</label>
            <input value={form.raw_gauge} onChange={(e) => updateForm('raw_gauge', e.target.value)} required
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-2 py-1.5 text-sm"
              placeholder="e.g. 1.2" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Raw Size (optional)</label>
            <input value={form.raw_size} onChange={(e) => updateForm('raw_size', e.target.value)}
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-2 py-1.5 text-sm"
              placeholder="leave blank = all sizes" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Raw Unit *</label>
            <select value={form.raw_unit} onChange={(e) => updateForm('raw_unit', e.target.value)}
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-2 py-1.5 text-sm">
              <option value="pieces">pieces (plates)</option>
              <option value="kg">kg (coils)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Finished Product *</label>
            <input value={form.finished_name} onChange={(e) => updateForm('finished_name', e.target.value)} required
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-2 py-1.5 text-sm"
              placeholder="e.g. Kibaati" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Finished Size</label>
            <input value={form.finished_size} onChange={(e) => updateForm('finished_size', e.target.value)}
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-2 py-1.5 text-sm"
              placeholder="e.g. 2 inch x 8ft" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Yield per 1 Raw Unit *</label>
            <input type="number" step="0.001" value={form.yield_per_raw_unit} onChange={(e) => updateForm('yield_per_raw_unit', e.target.value)} required
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-2 py-1.5 text-sm"
              placeholder="e.g. 22 (or 0.8 per kg)" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes (optional)</label>
            <input value={form.notes} onChange={(e) => updateForm('notes', e.target.value)}
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-2 py-1.5 text-sm"
              placeholder="e.g. boss standard 2026" />
          </div>
        </div>
        <button type="submit" disabled={saving}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-bold text-sm px-6 py-2 rounded-lg">
          {saving ? 'Saving...' : 'Save Standard'}
        </button>
      </form>

      <h2 className="text-lg font-bold text-white mb-3">Existing Standards</h2>
      <div className="overflow-x-auto bg-slate-800 rounded-xl max-w-4xl">
        <table className="w-full text-sm text-left text-slate-300">
          <thead className="bg-slate-700/50 text-slate-200 uppercase text-xs">
            <tr>
              <th className="px-4 py-3">Raw Material</th>
              <th className="px-4 py-3">Produces</th>
              <th className="px-4 py-3">Standard Yield</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {recipes.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">No standards yet — add the first one above.</td></tr>
            )}
            {recipes.map(r => (
              <tr key={r.id} className="border-t border-slate-700">
                <td className="px-4 py-3 font-semibold text-white">
                  {r.raw_category} {r.raw_gauge} {r.raw_size || ''} <span className="text-slate-500">({r.raw_unit})</span>
                </td>
                <td className="px-4 py-3">{r.finished_name} {r.finished_size || ''}</td>
                <td className="px-4 py-3 font-bold text-amber-400">{r.yield_per_raw_unit} per {r.raw_unit === 'kg' ? 'kg' : 'piece'}</td>
                <td className="px-4 py-3">
                  {profile?.role === 'super_admin' && (
                    <button onClick={() => handleDelete(r.id)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}