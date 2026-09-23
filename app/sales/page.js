'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

export default function SalesPage() {
  const [profile, setProfile] = useState(null)
  const [mode, setMode] = useState('finished')
  const [finished, setFinished] = useState([])
  const [raws, setRaws] = useState([])
  const [recipes, setRecipes] = useState([])
  const [batches, setBatches] = useState([])

  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [customer, setCustomer] = useState('')
  const [status, setStatus] = useState('paid')
  const [paidAmount, setPaidAmount] = useState('')

  const [recipeId, setRecipeId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [units, setUnits] = useState('')

  const [todaySales, setTodaySales] = useState([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  const loadToday = async (session, admin) => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    let q = supabase.from('sales').select('*').gte('created_at', start).order('created_at', { ascending: false })
    if (!admin) q = q.eq('sold_by', session.user.id)
    const { data } = await q
    setTodaySales(data || [])
  }

  const loadBatches = async (rec, admin) => {
    const source = admin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'
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
      const admin = prof?.role === 'admin' || prof?.role === 'super_admin'
      const { data: fgs } = await supabase.from('finished_goods').select('*').gt('quantity', 0).order('name')
      setFinished(fgs || [])
      const source = admin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'
      const { data: rws } = await supabase.from(source).select('*').gt('quantity', 0).order('created_at', { ascending: false })
      setRaws(rws || [])
      const { data: recs } = await supabase.from('production_recipes').select('*')
      setRecipes(recs || [])
      loadToday(session, admin)
    }
    load()
  }, [])

  const recipe = recipes.find(r => r.id === Number(recipeId))
  const batch = batches.find(b => b.id === Number(batchId))
  const total = qty && price ? Number(qty) * Number(price) : 0
  const paidValue = status === 'paid' ? total : status === 'credit' ? 0 : Number(paidAmount) || 0

  const finishSale = async (itemType, item, quantity, unitPrice, label) => {
    const { data: { session } } = await supabase.auth.getSession()
    const totalAmt = quantity * unitPrice
    const paid = status === 'paid' ? totalAmt : status === 'credit' ? 0 : Number(paidAmount) || 0

    const { error: dErr } = await supabase.rpc('deduct_stock', {
      p_item_type: itemType,
      p_item_id: item.id,
      p_quantity: quantity,
      p_movement_type: 'sold',
      p_notes: `Sold to ${customer || 'Walk-in'} (${status})`
    })
    if (dErr) return dErr.message

    const { error: sErr } = await supabase.from('sales').insert({
      item_type: itemType,
      item_id: item.id,
      quantity,
      unit_price: unitPrice,
      total_amount: totalAmt,
      amount_paid: paid,
      payment_status: status,
      customer_name: customer || 'Walk-in',
      sold_by: session.user.id,
      item_label: label
    })
    if (sErr) return sErr.message
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    const { data: { session } } = await supabase.auth.getSession()

    if (mode === 'make') {
      if (!recipe || !batch) { setMessage({ type: 'error', text: 'Choose standard and batch.' }); setSaving(false); return }
      const u = Number(units)
      const q = Number(qty)
      const p = Number(price)
      if (!u || !q || !p) { setMessage({ type: 'error', text: 'Fill units used, quantity and price.' }); setSaving(false); return }
      if (u > batch.quantity) { setMessage({ type: 'error', text: `Only ${batch.quantity} available in batch.` }); setSaving(false); return }

      let fg = null
      const { data: existing } = await supabase.from('finished_goods').select('*').ilike('name', recipe.finished_name).limit(1)
      if (existing && existing.length > 0) fg = existing[0]
      else {
        const { data: created, error: fgErr } = await supabase.from('finished_goods')
          .insert({ name: recipe.finished_name, gauge: recipe.raw_gauge, size_dimensions: recipe.finished_size, unit: 'pieces', quantity: 0, selling_price: p })
          .select().single()
        if (fgErr) { setMessage({ type: 'error', text: fgErr.message }); setSaving(false); return }
        fg = created
      }

      const expected = Number(recipe.yield_per_raw_unit) * u
      const { error: logErr } = await supabase.from('production_log').insert({
        finished_good_id: fg.id,
        boss_expected_yield: expected,
        actual_yield: q,
        raw_material_id: batch.id,
        fraction_of_material_used: u / batch.quantity,
        raw_units_used: u,
        scrap_generated: 0,
        employee_name: profile?.full_name
      })
      if (logErr) { setMessage({ type: 'error', text: logErr.message }); setSaving(false); return }

      const { error: d1 } = await supabase.rpc('deduct_stock', { p_item_type: 'raw', p_item_id: batch.id, p_quantity: u, p_movement_type: 'used_in_production', p_notes: 'Make & Sell production' })
      if (d1) { setMessage({ type: 'error', text: d1.message }); setSaving(false); return }
      const { error: a1 } = await supabase.rpc('add_stock', { p_item_type: 'finished', p_item_id: fg.id, p_quantity: q, p_movement_type: 'produced', p_notes: 'Make & Sell production' })
      if (a1) { setMessage({ type: 'error', text: a1.message }); setSaving(false); return }

      const label = `${fg.name} ${fg.gauge || ''} ${fg.size_dimensions || ''}`.trim()
      const err = await finishSale('finished', fg, q, p, label)
      if (err) { setMessage({ type: 'error', text: err }); setSaving(false); return }
      setMessage({ type: 'success', text: `Made & sold ${q} × ${label} to ${customer || 'Walk-in'} (${status}).` })
    } else {
      const list = mode === 'finished' ? finished : raws
      const item = list.find(i => i.id === Number(itemId))
      if (!item) { setMessage({ type: 'error', text: 'Choose the item being sold.' }); setSaving(false); return }
      const q = Number(qty)
      const p = Number(price)
      if (!q || !p) { setMessage({ type: 'error', text: 'Fill quantity and price.' }); setSaving(false); return }
      if (q > item.quantity) { setMessage({ type: 'error', text: `Only ${item.quantity} in stock.` }); setSaving(false); return }
      const label = mode === 'finished'
        ? `${item.name} ${item.gauge || ''} ${item.size_dimensions || ''}`.trim()
        : `${item.category} ${item.gauge || ''} ${item.size_dimensions || ''}`.trim()
      const err = await finishSale(mode === 'finished' ? 'finished' : 'raw', item, q, p, label)
      if (err) { setMessage({ type: 'error', text: err }); setSaving(false); return }
      setMessage({ type: 'success', text: `Sale recorded: ${q} × ${label} to ${customer || 'Walk-in'} (${status}).` })
    }

    setQty(''); setPrice(''); setCustomer(''); setPaidAmount(''); setUnits('')
    setStatus('paid')
    loadToday(session, isAdmin)
    setSaving(false)
  }

  if (!profile) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">💰 Record Sale</h1>
          <p className="text-slate-400 text-sm">Sell from stock — or make fresh and sell on the spot</p>
        </div>
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
      </header>

      {message && (
        <div className={`mb-4 max-w-2xl rounded-lg p-3 text-sm ${message.type === 'success' ? 'bg-green-900/50 text-green-200 border border-green-700' : 'bg-red-900/50 text-red-200 border border-red-700'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-slate-800 rounded-xl p-6 space-y-5 max-w-2xl mb-10">
        <div className="grid grid-cols-3 gap-2 bg-slate-900 p-1 rounded-lg">
          <button type="button" onClick={() => setMode('finished')}
            className={`py-2 rounded-md text-xs md:text-sm font-bold ${mode === 'finished' ? 'bg-amber-500 text-slate-900' : 'text-slate-400'}`}>
            Finished Goods
          </button>
          <button type="button" onClick={() => setMode('raw')}
            className={`py-2 rounded-md text-xs md:text-sm font-bold ${mode === 'raw' ? 'bg-amber-500 text-slate-900' : 'text-slate-400'}`}>
            Raw Materials
          </button>
          <button type="button" onClick={() => setMode('make')}
            className={`py-2 rounded-md text-xs md:text-sm font-bold ${mode === 'make' ? 'bg-amber-500 text-slate-900' : 'text-slate-400'}`}>
            🏭 Make & Sell
          </button>
        </div>

        {mode !== 'make' ? (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Select Item to Sell *</label>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} required
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2">
              <option value="">-- Choose stock --</option>
              {(mode === 'finished' ? finished : raws).map(i => (
                <option key={i.id} value={i.id}>
                  {mode === 'finished'
                    ? `${i.name} ${i.gauge || ''} ${i.size_dimensions || ''} — ${i.quantity} ${i.unit}`
                    : `${i.category} ${i.gauge || ''} ${i.size_dimensions || ''} — ${i.quantity} ${i.unit}`}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">1. Production Standard *</label>
              <select value={recipeId} onChange={(e) => { setRecipeId(e.target.value); const rec = recipes.find(r => r.id === Number(e.target.value)); if (rec) loadBatches(rec, isAdmin) }} required
                className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2">
                <option value="">-- Select standard --</option>
                {recipes.map(r => (
                  <option key={r.id} value={r.id}>{r.raw_category} {r.raw_gauge} → {r.finished_name} ({r.yield_per_raw_unit}/unit)</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">2. Batch to cut from *</label>
              <select value={batchId} onChange={(e) => setBatchId(e.target.value)} required
                className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2">
                <option value="">-- Select batch --</option>
                {batches.map(b => (
                  <option key={b.id} value={b.id}>Received {new Date(b.created_at).toLocaleDateString()} — {b.quantity} {b.unit} available</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">3. Raw units used *</label>
              <input type="number" step="0.001" value={units} onChange={(e) => setUnits(e.target.value)} required
                className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2" placeholder="e.g. 2 plates" />
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Quantity *</label>
            <input type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} required
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2" placeholder="e.g. 10" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Unit Price (UGX) *</label>
            <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2" placeholder="e.g. 15000" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Customer Name</label>
          <input value={customer} onChange={(e) => setCustomer(e.target.value)}
            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2" placeholder="e.g. John Doe (blank = walk-in)" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Payment Status *</label>
          <div className="grid grid-cols-3 gap-2">
            {['paid', 'partial', 'credit'].map(s => (
              <button key={s} type="button" onClick={() => setStatus(s)}
                className={`py-2 rounded-lg text-sm font-bold border capitalize ${status === s ? 'bg-amber-500 border-amber-500 text-slate-900' : 'border-slate-600 text-slate-300'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {status === 'partial' && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Amount paid now (UGX) *</label>
            <input type="number" step="0.01" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} required
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2" placeholder="e.g. 50000" />
          </div>
        )}

        {total > 0 && (
          <div className="bg-slate-900 rounded-lg p-3 text-sm border border-slate-700">
            Total: <span className="font-black text-amber-400">{total.toLocaleString()} UGX</span>
            {status !== 'paid' && <span className="text-slate-400"> · {status === 'credit' ? 'all owed' : `paid now ${paidValue.toLocaleString()}, owed ${(total - paidValue).toLocaleString()}`}</span>}
          </div>
        )}

        <button type="submit" disabled={saving}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-bold text-sm py-3 rounded-lg">
          {saving ? 'Saving...' : 'Complete Sale & Deduct Stock'}
        </button>
      </form>

      <h2 className="text-lg font-bold text-white mb-3">💰 Today's Sales {isAdmin ? '(all staff)' : '(yours)'}</h2>
      <div className="space-y-3 max-w-2xl">
        {todaySales.length === 0 && (
          <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500">No sales recorded yet today.</div>
        )}
        {todaySales.map(s => (
          <div key={s.id} className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="font-bold text-white">{s.item_label || 'Item'}</p>
              <span className={`text-xs font-bold px-2 py-1 rounded uppercase ${s.payment_status === 'paid' ? 'bg-green-500/20 text-green-300' : s.payment_status === 'partial' ? 'bg-amber-500/20 text-amber-300' : 'bg-red-500/20 text-red-300'}`}>
                {s.payment_status}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {s.quantity} × {Number(s.unit_price).toLocaleString()} → <span className="font-bold text-amber-400">{Number(s.total_amount).toLocaleString()} UGX</span> · {s.customer_name}
            </p>
            <p className="text-[10px] text-slate-500 mt-1">{new Date(s.created_at).toLocaleTimeString()}</p>
          </div>
        ))}
      </div>
    </main>
  )
}