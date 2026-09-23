'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

const UNITS = ['pieces', 'kg', 'bags', 'sheets', 'lengths', 'litres', 'boxes']

const emptyItem = () => ({ mode: 'dimensional', name: '', category: '', gauge: '', size: '', length: '', unit: 'pieces', quantity: '', weight: '', cost: '', desc: '' })

export default function DeliveriesPage() {
  const [profile, setProfile] = useState(null)
  const [supplier, setSupplier] = useState('')
  const [items, setItems] = useState([emptyItem()])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [todayDeliveries, setTodayDeliveries] = useState([])

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  const loadToday = async (admin) => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const { data: dels } = await supabase.from('deliveries').select('*').gte('created_at', start).order('created_at', { ascending: false })
    const ids = (dels || []).map(d => d.id)
    let raws = []
    if (ids.length > 0) {
      const source = admin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'
      const { data } = await supabase.from(source).select('*').in('delivery_id', ids)
      raws = data || []
    }
    setTodayDeliveries((dels || []).map(d => ({
      ...d,
      items: raws.filter(r => r.delivery_id === d.id)
    })))
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
      loadToday(prof?.role === 'admin' || prof?.role === 'super_admin')
    }
    load()
  }, [])

  const updateItem = (index, field, value) => {
    const next = [...items]
    next[index][field] = value
    setItems(next)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    const { data: { session } } = await supabase.auth.getSession()
    const { data: delivery, error: dErr } = await supabase
      .from('deliveries')
      .insert({ supplier_name: supplier, received_by: session.user.id })
      .select()
      .single()
    if (dErr) {
      setMessage({ type: 'error', text: dErr.message })
      setSaving(false)
      return
    }

    for (const item of items) {
      const isSimple = item.mode === 'simple'
      const category = isSimple ? item.name.trim() : item.category.trim()
      if (!category) {
        setMessage({ type: 'error', text: isSimple ? 'Enter the item name.' : 'Enter the category.' })
        setSaving(false)
        return
      }
      const { error } = await supabase.rpc('receive_delivery_item', {
        p_delivery_id: delivery.id,
        p_category: category,
        p_gauge: isSimple ? null : (item.gauge || null),
        p_size: isSimple ? null : (item.size || null),
        p_length: isSimple ? null : (item.length || null),
        p_unit: item.unit,
        p_quantity: Number(item.quantity),
        p_weight: Number(item.weight) || null,
        p_base_cost: isAdmin ? (Number(item.cost) || 0) : 0,
        p_notes: isSimple ? (item.desc || 'Simple item (non-dimensional)') : null
      })
      if (error) {
        setMessage({ type: 'error', text: error.message })
        setSaving(false)
        return
      }
    }

    setMessage({ type: 'success', text: `Delivery from ${supplier} recorded — ${items.length} item(s) added to stock.` })
    setSupplier('')
    setItems([emptyItem()])
    loadToday(isAdmin)
    setSaving(false)
  }

  if (!profile) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">📥 Receive New Delivery</h1>
          <p className="text-slate-400 text-sm">Record all items from one truck at once — dimensional or simple</p>
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
          <label className="block text-sm font-medium text-slate-300 mb-1">Supplier Name *</label>
          <input value={supplier} onChange={(e) => setSupplier(e.target.value)} required
            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2"
            placeholder="e.g. Uganda Baati, Roofings..." />
        </div>

        {!isAdmin && (
          <p className="text-xs text-slate-500">💡 Cost prices are entered by Admin only. Just record quantities — Admin adds prices later.</p>
        )}

        {items.map((item, i) => (
          <div key={i} className="border border-slate-600 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-bold text-amber-400 text-sm">Item {i + 1}</p>
              <div className="grid grid-cols-2 gap-1 bg-slate-900 p-1 rounded-lg">
                <button type="button" onClick={() => updateItem(i, 'mode', 'dimensional')}
                  className={`px-2 py-1 rounded-md text-[11px] font-bold ${item.mode === 'dimensional' ? 'bg-amber-500 text-slate-900' : 'text-slate-400'}`}>
                  📐 Dimensional
                </button>
                <button type="button" onClick={() => updateItem(i, 'mode', 'simple')}
                  className={`px-2 py-1 rounded-md text-[11px] font-bold ${item.mode === 'simple' ? 'bg-amber-500 text-slate-900' : 'text-slate-400'}`}>
                  🧾 Simple
                </button>
              </div>
            </div>

            {item.mode === 'simple' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">Item name *</label>
                  <input value={item.name} onChange={(e) => updateItem(i, 'name', e.target.value)} required
                    className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm"
                    placeholder="e.g. Cement, Roofing screws design X" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Unit *</label>
                  <select value={item.unit} onChange={(e) => updateItem(i, 'unit', e.target.value)}
                    className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm">
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Quantity *</label>
                  <input type="number" step="0.001" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} required
                    className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="e.g. 50" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Weight (kg) - optional</label>
                  <input type="number" step="0.01" value={item.weight} onChange={(e) => updateItem(i, 'weight', e.target.value)}
                    className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="e.g. 2500" />
                </div>
                {isAdmin && (
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Batch Cost (UGX)</label>
                    <input type="number" step="0.01" value={item.cost} onChange={(e) => updateItem(i, 'cost', e.target.value)}
                      className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="Total cost of this batch" />
                  </div>
                )}
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">Description (optional)</label>
                  <input value={item.desc} onChange={(e) => updateItem(i, 'desc', e.target.value)}
                    className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm"
                    placeholder="e.g. SIMBA 25kg bags, blue design" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Category *</label>
                  <input value={item.category} onChange={(e) => updateItem(i, 'category', e.target.value)} required
                    className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="e.g. Plain, Pipe" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Gauge</label>
                  <input value={item.gauge} onChange={(e) => updateItem(i, 'gauge', e.target.value)}
                    className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="e.g. 1.2mm" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Size / Dimensions</label>
                  <input value={item.size} onChange={(e) => updateItem(i, 'size', e.target.value)}
                    className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="e.g. 4x8ft" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Length (optional)</label>
                  <input value={item.length} onChange={(e) => updateItem(i, 'length', e.target.value)}
                    className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="e.g. 20ft" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Unit *</label>
                  <select value={item.unit} onChange={(e) => updateItem(i, 'unit', e.target.value)}
                    className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm">
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Quantity *</label>
                  <input type="number" step="0.001" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} required
                    className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="e.g. 600" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Weight (kg) - optional</label>
                  <input type="number" step="0.01" value={item.weight} onChange={(e) => updateItem(i, 'weight', e.target.value)}
                    className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="e.g. 8500" />
                </div>
                {isAdmin && (
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Batch Cost (UGX)</label>
                    <input type="number" step="0.01" value={item.cost} onChange={(e) => updateItem(i, 'cost', e.target.value)}
                      className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="Total cost of this batch" />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        <div className="flex gap-3">
          <button type="button" onClick={() => setItems([...items, emptyItem()])}
            className="border border-amber-500 text-amber-400 font-bold text-sm px-4 py-3 rounded-lg hover:bg-amber-500/10">
            + Add Another Item
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-bold text-sm py-3 rounded-lg">
            {saving ? 'Saving...' : 'Save Entire Delivery'}
          </button>
        </div>
      </form>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-white">📥 Today's Deliveries</h2>
        <button onClick={() => loadToday(isAdmin)} 
          className="text-xs bg-slate-700 hover:bg-slate-600 text-white font-bold px-3 py-1.5 rounded-lg">
          ↻ Refresh
        </button>
      </div>
      <div className="space-y-3 max-w-2xl">
        {todayDeliveries.length === 0 && (
          <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500">No deliveries recorded yet today.</div>
        )}
        {todayDeliveries.map(d => (
          <div key={d.id} className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-bold text-white">🚛 {d.supplier_name}</p>
              <p className="text-xs text-slate-500">{new Date(d.created_at).toLocaleTimeString()}</p>
            </div>
            <div className="space-y-2">
              {d.items.map(it => (
                <div key={it.id} className="flex items-center justify-between bg-slate-900/50 rounded-lg p-2 text-sm">
                  <span className="text-slate-300">
                    {it.category} {it.gauge || ''} {it.size_dimensions || ''}
                    {it.notes && <span className="text-slate-500 text-xs"> · {it.notes}</span>}
                  </span>
                  <span className="font-bold text-amber-400">+{it.quantity} {it.unit}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}