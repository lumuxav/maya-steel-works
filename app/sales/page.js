'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { SYSTEM_BRANCH, isSystemBranch, getSystemUserIds } from '../../lib/branch'
import { getSessionProfile } from '../../lib/sessionCache'

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
  const recipe = recipes.find(r => r.id === Number(recipeId))
  const batch = batches.find(b => b.id === Number(batchId))
  const total = qty && price ? Number(qty) * Number(price) : 0

  const loadToday = async (session, admin) => {
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString()
    const [systemUsers, { data }] = await Promise.all([
      getSystemUserIds(supabase),
      supabase.from('sales').select('*').gte('created_at', start).order('created_at', { ascending: false }),
    ])
    const branchRows = (data || []).filter(x => systemUsers.has(x.sold_by))
    setTodaySales(admin ? branchRows : branchRows.filter(x => x.sold_by === session.user.id))
  }

  const loadBatches = async (rec, admin) => {
    const source = admin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'
    const { data } = await supabase.from(source).select('*').ilike('category', rec.raw_category).gt('quantity', 0).order('created_at', { ascending: true })
    let rows = (data || []).filter(r => isSystemBranch(r.current_branch))
    if (rec.raw_gauge) rows = rows.filter(r => (r.gauge || '').toLowerCase().includes(rec.raw_gauge.toLowerCase()))
    if (rec.raw_size) rows = rows.filter(r => (r.size_dimensions || '').toLowerCase().includes(rec.raw_size.toLowerCase()))
    setBatches(rows)
    setBatchId('')
  }

  useEffect(() => {
    const load = async () => {
      const { session, profile: prof } = await getSessionProfile()
      if (!session) return (window.location.href = '/login')
      setProfile(prof)
      const admin = prof?.role === 'admin' || prof?.role === 'super_admin'
      const source = admin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'

      const [fgsRes, rwsRes, recsRes] = await Promise.all([
        supabase.from('finished_goods').select('*').gt('quantity', 0).order('name'),
        supabase.from(source).select('*').gt('quantity', 0).order('created_at', { ascending: false }),
        supabase.from('production_recipes').select('*'),
      ])

      setFinished((fgsRes.data || []).filter(i => isSystemBranch(i.current_branch)))
      setRaws((rwsRes.data || []).filter(i => isSystemBranch(i.current_branch)))
      setRecipes(recsRes.data || [])
      loadToday(session, admin)
    }
    load()
  }, [])

  const finishSale = async (itemType, item, quantity, unitPrice, label) => {
    const { data: { session } } = await supabase.auth.getSession()
    const totalAmt = quantity * unitPrice
    const paid = status === 'paid' ? totalAmt : status === 'credit' ? 0 : Number(paidAmount) || 0
    const { data: createdSale, error: sErr } = await supabase.from('sales').insert({ item_type: itemType, item_id: item.id, quantity, unit_price: unitPrice, selling_price: unitPrice, total_amount: totalAmt, amount_paid: paid, payment_status: status, customer_name: customer || 'Walk-in', sold_by: session.user.id, item_label: label }).select('id').single()
    if (sErr) return sErr.message
    const { error: dErr } = await supabase.rpc('deduct_stock', { p_item_type: itemType, p_item_id: item.id, p_quantity: quantity, p_movement_type: 'sold', p_notes: `Maya Branch sale to ${customer || 'Walk-in'} (${status})` })
    if (dErr) { if (createdSale?.id) await supabase.from('sales').delete().eq('id', createdSale.id); return dErr.message }
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setMessage(null)
    const { data: { session } } = await supabase.auth.getSession()
    if (mode === 'make') {
      if (!recipe || !batch) { setMessage({ type: 'error', text: 'Choose production standard and Maya Branch batch.' }); setSaving(false); return }
      const u = Number(units), q = Number(qty), p = Number(price)
      if (!u || !q || !p) { setMessage({ type: 'error', text: 'Fill units used, quantity and price.' }); setSaving(false); return }
      if (u > batch.quantity) { setMessage({ type: 'error', text: `Only ${batch.quantity} available at Maya Branch.` }); setSaving(false); return }
      let fg = finished.find(x => x.name?.toLowerCase() === recipe.finished_name?.toLowerCase()) || null
      if (!fg) {
        const { data: created, error: fgErr } = await supabase.from('finished_goods').insert({ name: recipe.finished_name, gauge: recipe.raw_gauge, size_dimensions: recipe.finished_size, unit: 'pieces', quantity: 0, selling_price: p, current_branch: SYSTEM_BRANCH }).select().single()
        if (fgErr) { setMessage({ type: 'error', text: fgErr.message }); setSaving(false); return }
        fg = created
      }
      const expected = Number(recipe.yield_per_raw_unit) * u
      const { error: logErr } = await supabase.from('production_log').insert({ finished_good_id: fg.id, boss_expected_yield: expected, actual_yield: q, raw_material_id: batch.id, fraction_of_material_used: u / batch.quantity, raw_units_used: u, scrap_generated: 0, employee_name: profile?.full_name })
      if (logErr) { setMessage({ type: 'error', text: logErr.message }); setSaving(false); return }
      const { error: d1 } = await supabase.rpc('deduct_stock', { p_item_type: 'raw', p_item_id: batch.id, p_quantity: u, p_movement_type: 'used_in_production', p_notes: 'Maya Branch Make & Sell' })
      if (d1) { setMessage({ type: 'error', text: d1.message }); setSaving(false); return }
      const { error: a1 } = await supabase.rpc('add_stock', { p_item_type: 'finished', p_item_id: fg.id, p_quantity: q, p_movement_type: 'produced', p_notes: 'Maya Branch Make & Sell' })
      if (a1) { setMessage({ type: 'error', text: a1.message }); setSaving(false); return }
      const label = `${fg.name} ${fg.gauge || ''} ${fg.size_dimensions || ''}`.trim()
      const err = await finishSale('finished', fg, q, p, label)
      if (err) { setMessage({ type: 'error', text: err }); setSaving(false); return }
      setMessage({ type: 'success', text: `Made and sold ${q} × ${label}.` })
    } else {
      const list = mode === 'finished' ? finished : raws
      const item = list.find(i => i.id === Number(itemId))
      if (!item) { setMessage({ type: 'error', text: 'Choose Maya Branch stock.' }); setSaving(false); return }
      const q = Number(qty), p = Number(price)
      if (!q || !p) { setMessage({ type: 'error', text: 'Fill quantity and price.' }); setSaving(false); return }
      if (q > item.quantity) { setMessage({ type: 'error', text: `Only ${item.quantity} available at Maya Branch.` }); setSaving(false); return }
      const label = mode === 'finished' ? `${item.name} ${item.gauge || ''} ${item.size_dimensions || ''}`.trim() : `${item.category} ${item.gauge || ''} ${item.size_dimensions || ''}`.trim()
      const err = await finishSale(mode === 'finished' ? 'finished' : 'raw', item, q, p, label)
      if (err) { setMessage({ type: 'error', text: err }); setSaving(false); return }
      setMessage({ type: 'success', text: `Maya Branch sale recorded: ${q} × ${label}.` })
    }
    setQty(''); setPrice(''); setCustomer(''); setPaidAmount(''); setUnits(''); setStatus('paid'); setItemId('')
    loadToday(session, isAdmin); setSaving(false)
  }

  if (!profile) return <main className="page-wrap text-muted">Loading sales...</main>

  return <main className="page-wrap">
    <div className="page-header-row"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Record Sale</h1><p className="page-subtitle">Only Maya Branch stock is available here.</p></div><Link href="/customer-work" className="rounded-xl border border-amber-500/40 px-3 py-2 text-sm font-bold text-amber-500">Customer material</Link></div>
    {message && <div className={`mb-4 max-w-2xl rounded-xl border p-3 text-sm ${message.type === 'success' ? 'border-green-500/30 bg-green-500/10 text-green-500' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}>{message.text}</div>}
    <form onSubmit={handleSubmit} className="page-card mb-8 max-w-2xl space-y-5 p-5 sm:p-6">
      <div className="grid grid-cols-3 gap-2 rounded-xl bg-[var(--panel-2)] p-1">{[['finished','Finished Goods'],['raw','Raw Materials'],['make','Make & Sell']].map(([key,label]) => <button key={key} type="button" onClick={() => { setMode(key); setItemId('') }} className={`rounded-lg py-2 text-xs font-bold sm:text-sm ${mode === key ? 'bg-amber-500 text-slate-950' : 'text-muted'}`}>{label}</button>)}</div>
      {mode !== 'make' ? <div><label className="mb-2 block text-sm font-bold">Select Maya Branch item *</label><select value={itemId} onChange={(e) => setItemId(e.target.value)} required className="input-base"><option value="">Choose stock</option>{(mode === 'finished' ? finished : raws).map(i => <option key={i.id} value={i.id}>{mode === 'finished' ? `${i.name} ${i.gauge || ''} ${i.size_dimensions || ''}` : `${i.category} ${i.gauge || ''} ${i.size_dimensions || ''}`} — {i.quantity} {i.unit}</option>)}</select></div> : <><div><label className="mb-2 block text-sm font-bold">Production standard *</label><select value={recipeId} onChange={(e) => { setRecipeId(e.target.value); const rec = recipes.find(r => r.id === Number(e.target.value)); if (rec) loadBatches(rec, isAdmin) }} required className="input-base"><option value="">Select standard</option>{recipes.map(r => <option key={r.id} value={r.id}>{r.raw_category} {r.raw_gauge} → {r.finished_name}</option>)}</select></div><div><label className="mb-2 block text-sm font-bold">Maya Branch batch *</label><select value={batchId} onChange={(e) => setBatchId(e.target.value)} required className="input-base"><option value="">Select batch</option>{batches.map(b => <option key={b.id} value={b.id}>{new Date(b.created_at).toLocaleDateString()} — {b.quantity} {b.unit}</option>)}</select></div><div><label className="mb-2 block text-sm font-bold">Raw units used *</label><input type="number" step="0.001" value={units} onChange={(e) => setUnits(e.target.value)} required className="input-base" /></div></>}
      <div className="grid grid-cols-2 gap-4"><div><label className="mb-2 block text-sm font-bold">Quantity *</label><input type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} required className="input-base" /></div><div><label className="mb-2 block text-sm font-bold">Unit Price (UGX) *</label><input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required className="input-base" /></div></div>
      <div><label className="mb-2 block text-sm font-bold">Customer Name</label><input value={customer} onChange={(e) => setCustomer(e.target.value)} className="input-base" placeholder="Blank = walk-in" /></div>
      <div><label className="mb-2 block text-sm font-bold">Payment Status *</label><div className="grid grid-cols-3 gap-2">{['paid','partial','credit'].map(x => <button key={x} type="button" onClick={() => setStatus(x)} className={`rounded-xl border py-3 text-sm font-bold capitalize ${status === x ? 'border-amber-500 bg-amber-500 text-slate-950' : 'btn-secondary'}`}>{x}</button>)}</div></div>
      {status === 'partial' && <input type="number" step="0.01" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} required className="input-base" placeholder="Amount paid now" />}
      {total > 0 && <div className="rounded-xl bg-[var(--panel-2)] p-4"><span className="text-sm text-muted">Total: </span><strong className="text-amber-500">{total.toLocaleString()} UGX</strong></div>}
      <button type="submit" disabled={saving} className="w-full rounded-xl bg-amber-500 py-3.5 font-black text-slate-950 disabled:opacity-50">{saving ? 'Saving...' : 'Complete Sale & Deduct Maya Stock'}</button>
    </form>
    <section className="max-w-2xl"><h2 className="mb-3 text-lg font-black">Today&apos;s Maya Branch sales {isAdmin ? '(all staff)' : '(yours)'}</h2><div className="space-y-3">{todaySales.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No sales recorded today.</div>}{todaySales.map(s => <div key={s.id} className="page-card p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{s.item_label}</p><p className="mt-1 text-sm text-muted">{s.quantity} × {Number(s.unit_price).toLocaleString()} — <strong>{Number(s.total_amount).toLocaleString()} UGX</strong> · {s.customer_name}</p></div><span className={`rounded-lg px-2 py-1 text-[10px] font-black uppercase ${s.payment_status === 'paid' ? 'bg-green-500/10 text-green-500' : s.payment_status === 'partial' ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500'}`}>{s.payment_status}</span></div></div>)}</div></section>
  </main>
}
