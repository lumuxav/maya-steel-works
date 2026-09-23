'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

const BRANCH_OPTIONS = ['Maya Branch', 'Mbarara', 'Site / Project', 'All branches']

const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function StocktakePage() {
  const [profile, setProfile] = useState(null)
  const [itemType, setItemType] = useState('raw')
  const [branchFilter, setBranchFilter] = useState('Maya Branch')
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
      setItems(data || [])
    } else {
      const { data } = await supabase.from('finished_goods').select('*').order('name')
      setItems(data || [])
    }
    setGroupId('')
    setPhysical('')
  }

  const loadHistory = async (admin) => {
    const { data } = await supabase.from('stocktakes').select('*').order('count_date', { ascending: false }).limit(200)
    setCounts(data || [])
    if (admin) {
      const { data: users } = await supabase.from('users').select('id, full_name')
      setUserMap(Object.fromEntries((users || []).map(u => [u.id, u])))
    }
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
      loadItems('raw', admin)
      loadHistory(admin)
    }
    load()
  }, [])

  const switchType = (t) => {
    setItemType(t)
    loadItems(t, isAdmin)
  }

  const visibleItems = items.filter(i =>
    branchFilter === 'All branches' || (i.current_branch || 'Maya Branch') === branchFilter
  )
  const groupMap = {}
  visibleItems.forEach(i => {
    const key = itemType === 'raw'
      ? `${i.category}|${i.gauge || ''}|${i.size_dimensions || ''}`
      : `${i.name}|${i.gauge || ''}|${i.size_dimensions || ''}`
    if (!groupMap[key]) {
      groupMap[key] = {
        key,
        label: itemType === 'raw'
          ? `${i.category} ${i.gauge || ''} ${i.size_dimensions || ''}`.trim()
          : `${i.name} ${i.gauge || ''} ${i.size_dimensions || ''}`.trim(),
        unit: i.unit,
        total: 0,
        batches: []
      }
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

    const alloc = allocate(group.batches, Number(physical))
    for (const a of alloc) {
      if (Number(a.batch.quantity) === 0 && a.phys === 0) continue
      const { error } = await supabase.rpc('record_stocktake', {
        p_item_type: itemType,
        p_item_id: a.batch.id,
        p_physical: a.phys,
        p_notes: notes ? `${notes} (grouped count)` : 'Grouped shelf count',
        p_counter_name: counterName.trim() || null
      })
      if (error) { setMessage({ type: 'error', text: error.message }); setSaving(false); return }
    }

    const d = Number(physical) - group.total
    setMessage({
      type: d === 0 ? 'success' : 'warn',
      text: d === 0
        ? 'Count matches system exactly ✅ — report updated below.'
        : `Count saved. Group difference of ${d} spread across ${group.batches.length} batch(es) — report updated below.`
    })
    setPhysical('')
    setCounterName('')
    setNotes('')
    loadItems(itemType, isAdmin)
    loadHistory(isAdmin)
    setSaving(false)
  }

  if (!profile) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  // per-day grouping of history
  const byDay = {}
  counts.forEach(c => {
    const day = toDayStr(new Date(c.count_date))
    byDay[day] = byDay[day] || []
    byDay[day].push(c)
  })
  const days = Object.keys(byDay).sort().reverse()

  const counterOf = (c) => c.counter_name || (isAdmin ? (userMap[c.counted_by]?.full_name || '—') : 'staff')

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">📋 Stocktake (Physical Count)</h1>
          <p className="text-slate-400 text-sm">Count shelf totals — the system splits it across batches and writes the day's report</p>
        </div>
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
      </header>

      {message && (
        <div className={`mb-4 max-w-2xl rounded-lg p-3 text-sm ${
          message.type === 'success' ? 'bg-green-900/50 text-green-200 border border-green-700'
          : message.type === 'warn' ? 'bg-amber-900/50 text-amber-200 border border-amber-600'
          : 'bg-red-900/50 text-red-200 border border-red-700'
        }`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-slate-800 rounded-xl p-6 space-y-5 max-w-2xl mb-10">
        <div className="grid grid-cols-2 gap-2 bg-slate-900 p-1 rounded-lg">
          <button type="button" onClick={() => switchType('raw')}
            className={`py-2 rounded-md text-sm font-bold ${itemType === 'raw' ? 'bg-amber-500 text-slate-900' : 'text-slate-400'}`}>
            Raw Materials
          </button>
          <button type="button" onClick={() => switchType('finished')}
            className={`py-2 rounded-md text-sm font-bold ${itemType === 'finished' ? 'bg-amber-500 text-slate-900' : 'text-slate-400'}`}>
            Finished Goods
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">1. Which branch are you counting? *</label>
          <select value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setGroupId(''); setPhysical('') }}
            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2">
            {BRANCH_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">2. Item counted (shelf total) *</label>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} required
            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2">
            <option value="">-- Choose item --</option>
            {groups.map(g => (
              <option key={g.key} value={g.key}>
                {g.label} — system total: {g.total} {g.unit} ({g.batches.length} batch{g.batches.length > 1 ? 'es' : ''})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">3. Total physical count *</label>
            <input type="number" step="0.001" value={physical} onChange={(e) => setPhysical(e.target.value)} required
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2" placeholder="Counted pieces" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Who physically counted?</label>
            <input value={counterName} onChange={(e) => setCounterName(e.target.value)}
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2" placeholder="Name (blank = you)" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Notes (optional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2" placeholder="e.g. 2 pieces rusted" />
        </div>

        {diff !== null && (
          <div className={`rounded-lg p-3 text-sm font-bold ${diff === 0 ? 'bg-green-900/40 text-green-300 border border-green-700' : 'bg-red-900/40 text-red-300 border border-red-600'}`}>
            {diff === 0
              ? '✅ Physical matches system exactly.'
              : `⚠️ Group difference: ${diff > 0 ? '+' : ''}${diff} — will be spread across the ${group.batches.length} batch(es) and recorded permanently.`}
          </div>
        )}

        <button type="submit" disabled={saving}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-bold text-sm py-3 rounded-lg">
          {saving ? 'Saving count...' : 'Submit Physical Count'}
        </button>
      </form>

      <h2 className="text-lg font-bold text-white mb-4">📋 Count Reports (auto-generated per day)</h2>
      <div className="space-y-8 max-w-3xl">
        {days.length === 0 && (
          <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500">No stocktakes yet.</div>
        )}
        {days.map(day => {
          const rows = byDay[day]
          const matches = rows.filter(r => Number(r.difference) === 0).length
          const diffs = rows.filter(r => Number(r.difference) !== 0).length
          const net = rows.reduce((s, r) => s + Number(r.difference), 0)
          const counters = Array.from(new Set(rows.map(counterOf))).join(', ')
          return (
            <div key={day}>
              <div className={`rounded-xl border p-4 mb-3 ${diffs > 0 ? 'border-red-500/40 bg-red-900/10' : 'border-green-500/40 bg-green-900/10'}`}>
                <p className="font-black text-white text-base">📅 {day} — Count Report</p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm">
                  <span className="text-slate-300">Items counted: <span className="font-bold text-white">{rows.length}</span></span>
                  <span className="text-green-400 font-bold">✅ {matches} matched</span>
                  <span className={`font-bold ${diffs > 0 ? 'text-red-400' : 'text-slate-500'}`}>⚠️ {diffs} difference(s)</span>
                  <span className={`font-bold ${net === 0 ? 'text-slate-300' : net < 0 ? 'text-red-400' : 'text-amber-400'}`}>
                    Net pieces: {net > 0 ? '+' : ''}{net}
                  </span>
                  <span className="text-slate-400">Counters: {counters}</span>
                </div>
              </div>

              <div className="overflow-x-auto bg-slate-800 rounded-xl border border-slate-700">
                <table className="w-full min-w-[640px] text-sm text-left text-slate-300">
                  <thead className="bg-slate-700/50 text-slate-200 uppercase text-xs">
                    <tr>
                      <th className="px-4 py-3">Item</th>
                      <th className="px-4 py-3">System</th>
                      <th className="px-4 py-3">Physical</th>
                      <th className="px-4 py-3">Difference</th>
                      <th className="px-4 py-3">Counted by</th>
                      <th className="px-4 py-3">Notes</th>
                      <th className="px-4 py-3">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(c => (
                      <tr key={c.id} className="border-t border-slate-700">
                        <td className="px-4 py-3 font-semibold text-white whitespace-nowrap">{c.item_label || `Item #${c.item_id}`}</td>
                        <td className="px-4 py-3">{c.system_quantity}</td>
                        <td className="px-4 py-3 font-bold text-white">{c.physical_quantity}</td>
                        <td className={`px-4 py-3 font-black ${Number(c.difference) === 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {Number(c.difference) > 0 ? '+' : ''}{c.difference}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{counterOf(c)}</td>
                        <td className="px-4 py-3 text-xs">{c.notes || '—'}</td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">{new Date(c.count_date).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </div>
    </main>
  )
}