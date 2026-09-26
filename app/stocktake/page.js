'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SYSTEM_BRANCH, isSystemBranch } from '../../lib/branch'

const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function StocktakePage() {
  const [profile, setProfile] = useState(null)
  const [itemType, setItemType] = useState('raw')
  const [items, setItems] = useState([])
  const [groupId, setGroupId] = useState('')
  const [physical, setPhysical] = useState('')
  const [counterName, setCounterName] = useState('')
  const [notes, setNotes] = useState('')
  const [counts, setCounts] = useState([])
  const [userMap, setUserMap] = useState({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  const loadItems = async (type, admin) => {
    if (type === 'raw') {
      const source = admin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'
      const { data } = await supabase.from(source).select('*').order('created_at', { ascending: false })
      setItems((data || []).filter(i => isSystemBranch(i.current_branch)))
    } else {
      const { data } = await supabase.from('finished_goods').select('*').order('name')
      setItems((data || []).filter(i => isSystemBranch(i.current_branch)))
    }
    setGroupId('')
    setPhysical('')
  }

  const loadHistory = async (admin) => {
    const rawSource = admin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'
    const { data: raws } = await supabase.from(rawSource).select('id,current_branch')
    const { data: fins } = await supabase.from('finished_goods').select('id,current_branch')
    const rawIds = new Set((raws || []).filter(i => isSystemBranch(i.current_branch)).map(i => i.id))
    const fgIds = new Set((fins || []).filter(i => isSystemBranch(i.current_branch)).map(i => i.id))
    const { data } = await supabase.from('stocktakes').select('*').order('count_date', { ascending: false }).limit(200)
    setCounts((data || []).filter(c => c.item_type === 'raw' ? rawIds.has(c.item_id) : fgIds.has(c.item_id)))
    if (admin) {
      const { data: users } = await supabase.from('users').select('id, full_name')
      setUserMap(Object.fromEntries((users || []).map(u => [u.id, u])))
    }
  }

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return (window.location.href = '/login')
      const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
      setProfile(prof)
      const admin = prof?.role === 'admin' || prof?.role === 'super_admin'
      loadItems('raw', admin)
      loadHistory(admin)
    }
    load()
  }, [])

  const switchType = (t) => { setItemType(t); loadItems(t, isAdmin) }

  const groupMap = {}
  items.forEach(i => {
    const key = itemType === 'raw' ? `${i.category}|${i.gauge || ''}|${i.size_dimensions || ''}` : `${i.name}|${i.gauge || ''}|${i.size_dimensions || ''}`
    if (!groupMap[key]) groupMap[key] = {
      key,
      label: itemType === 'raw' ? `${i.category} ${i.gauge || ''} ${i.size_dimensions || ''}`.trim() : `${i.name} ${i.gauge || ''} ${i.size_dimensions || ''}`.trim(),
      unit: i.unit,
      total: 0,
      batches: []
    }
    groupMap[key].total += Number(i.quantity)
    groupMap[key].batches.push(i)
  })
  const groups = Object.values(groupMap).filter(g => g.total > 0)
  const group = groups.find(g => g.key === groupId)
  const diff = group && physical !== '' ? Number(physical) - group.total : null

  const allocate = (batches, phys) => {
    const total = batches.reduce((s, b) => s + Number(b.quantity), 0)
    if (total <= 0) return batches.map(b => ({ batch: b, phys: 0 }))
    let remaining = phys
    return batches.map((b, i) => {
      if (i === batches.length - 1) return { batch: b, phys: remaining }
      const p = Math.floor(phys * Number(b.quantity) / total)
      remaining -= p
      return { batch: b, phys: p }
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    if (!group) { setMessage({ type: 'error', text: 'Select the item you counted.' }); setSaving(false); return }
    if (physical === '') { setMessage({ type: 'error', text: 'Enter the total physical count.' }); setSaving(false); return }

    for (const a of allocate(group.batches, Number(physical))) {
      if (Number(a.batch.quantity) === 0 && a.phys === 0) continue
      const { error } = await supabase.rpc('record_stocktake', {
        p_item_type: itemType,
        p_item_id: a.batch.id,
        p_physical: a.phys,
        p_notes: notes ? `${notes} (Maya Branch grouped count)` : 'Maya Branch grouped shelf count',
        p_counter_name: counterName.trim() || null
      })
      if (error) { setMessage({ type: 'error', text: error.message }); setSaving(false); return }
    }

    const d = Number(physical) - group.total
    setMessage({ type: d === 0 ? 'success' : 'warn', text: d === 0 ? 'Count matches Maya Branch stock exactly.' : `Count saved. Maya Branch difference: ${d}.` })
    setPhysical(''); setCounterName(''); setNotes('')
    loadItems(itemType, isAdmin)
    loadHistory(isAdmin)
    setSaving(false)
  }

  if (!profile) return <main className="page-wrap text-muted">Loading stocktake...</main>

  const byDay = {}
  counts.forEach(c => { const day = toDayStr(new Date(c.count_date)); byDay[day] = byDay[day] || []; byDay[day].push(c) })
  const days = Object.keys(byDay).sort().reverse()
  const counterOf = (c) => c.counter_name || (isAdmin ? (userMap[c.counted_by]?.full_name || '—') : 'staff')

  return (
    <main className="page-wrap">
      <div className="page-header-row"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Stocktake</h1><p className="page-subtitle">Physical counts for Maya Branch only.</p></div></div>

      {message && <div className={`mb-4 max-w-2xl rounded-xl border p-3 text-sm ${message.type === 'success' ? 'border-green-500/30 bg-green-500/10 text-green-500' : message.type === 'warn' ? 'border-amber-500/30 bg-amber-500/10 text-amber-500' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}>{message.text}</div>}

      <form onSubmit={handleSubmit} className="page-card max-w-2xl space-y-5 p-5 sm:p-6">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--panel-2)] p-1">
          <button type="button" onClick={() => switchType('raw')} className={`rounded-lg py-2.5 text-sm font-bold ${itemType === 'raw' ? 'bg-amber-500 text-slate-950' : 'text-muted'}`}>Raw Materials</button>
          <button type="button" onClick={() => switchType('finished')} className={`rounded-lg py-2.5 text-sm font-bold ${itemType === 'finished' ? 'bg-amber-500 text-slate-950' : 'text-muted'}`}>Finished Goods</button>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm"><strong className="text-amber-500">Counting:</strong> {SYSTEM_BRANCH}</div>
        <div><label className="mb-2 block text-sm font-bold">Item counted *</label><select value={groupId} onChange={(e) => setGroupId(e.target.value)} required className="input-base"><option value="">Choose item</option>{groups.map(g => <option key={g.key} value={g.key}>{g.label} — system total: {g.total} {g.unit}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-4"><div><label className="mb-2 block text-sm font-bold">Total physical count *</label><input type="number" step="0.001" value={physical} onChange={(e) => setPhysical(e.target.value)} required className="input-base" placeholder="Counted pieces" /></div><div><label className="mb-2 block text-sm font-bold">Who counted?</label><input value={counterName} onChange={(e) => setCounterName(e.target.value)} className="input-base" placeholder="Blank = you" /></div></div>
        <div><label className="mb-2 block text-sm font-bold">Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className="input-base" placeholder="Optional" /></div>
        {diff !== null && <div className={`rounded-xl p-3 text-sm font-bold ${diff === 0 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>{diff === 0 ? 'Physical matches system exactly.' : `Difference: ${diff > 0 ? '+' : ''}${diff}`}</div>}
        <button type="submit" disabled={saving} className="w-full rounded-xl bg-amber-500 py-3 font-black text-slate-950 disabled:opacity-50">{saving ? 'Saving...' : 'Submit Physical Count'}</button>
      </form>

      <section className="mt-8 max-w-3xl"><h2 className="mb-4 text-lg font-black">Maya Branch count reports</h2><div className="space-y-5">{days.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No Maya Branch stocktakes yet.</div>}{days.map(day => <div key={day} className="page-card p-4"><p className="font-black">{day}</p><div className="mt-3 space-y-2">{byDay[day].map(c => <div key={c.id} className="rounded-xl bg-[var(--panel-2)] p-3 text-sm"><div className="flex items-center justify-between gap-3"><strong>{c.item_label || `Item #${c.item_id}`}</strong><span className={Number(c.difference) === 0 ? 'text-green-500' : 'text-red-500'}>{Number(c.difference) > 0 ? '+' : ''}{c.difference}</span></div><p className="mt-1 text-xs text-muted">System {c.system_quantity} · Physical {c.physical_quantity} · {counterOf(c)}</p></div>)}</div></div>)}</div></section>
    </main>
  )
}
