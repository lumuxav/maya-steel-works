'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

const BRANCHES = ['Maya Branch', 'Mbarara', 'Site / Project']
const BRANCH_OPTIONS = ['Maya Branch', 'Mbarara', 'Site / Project', 'All branches']

const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function TransfersPage() {
  const nowLocal = new Date()
  nowLocal.setMinutes(nowLocal.getMinutes() - nowLocal.getTimezoneOffset())
  const nowInput = nowLocal.toISOString().slice(0, 16)

  const [profile, setProfile] = useState(null)
  const [itemType, setItemType] = useState('raw')
  const [branchFilter, setBranchFilter] = useState('Maya Branch')
  const [items, setItems] = useState([])
  const [sourceId, setSourceId] = useState('')
  const [destBranch, setDestBranch] = useState('Mbarara')
  const [quantity, setQuantity] = useState('')
  const [headName, setHeadName] = useState('')
  const [transferAt, setTransferAt] = useState(nowInput)
  const [transfers, setTransfers] = useState([])
  const [userMap, setUserMap] = useState({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  const loadItems = async (type, admin) => {
    if (type === 'raw') {
      const source = admin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'
      const { data } = await supabase.from(source).select('*').gt('quantity', 0).order('created_at', { ascending: false })
      setItems(data || [])
    } else {
      const { data } = await supabase.from('finished_goods').select('*').gt('quantity', 0).order('name')
      setItems(data || [])
    }
    setSourceId('')
  }

  const loadHistory = async (admin) => {
    const { data } = await supabase.from('branch_transfers').select('*').order('transfer_date', { ascending: false }).limit(200)
    setTransfers(data || [])
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

  const src = visibleItems.find(i => i.id === Number(sourceId))
  const destOptions = BRANCHES.filter(b => b !== branchFilter)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    if (!src) { setMessage({ type: 'error', text: 'Select the stock to move.' }); setSaving(false); return }
    if (Number(quantity) <= 0) { setMessage({ type: 'error', text: 'Enter a quantity greater than 0.' }); setSaving(false); return }
    if (Number(quantity) > src.quantity) { setMessage({ type: 'error', text: `Only ${src.quantity} available at ${src.current_branch}.` }); setSaving(false); return }
    if (src.current_branch === destBranch) { setMessage({ type: 'error', text: `This stock is already at ${destBranch}.` }); setSaving(false); return }

    const { error } = await supabase.rpc('transfer_stock', {
      p_item_type: itemType,
      p_source_id: src.id,
      p_quantity: Number(quantity),
      p_destination_branch: destBranch,
      p_transfer_at: transferAt ? new Date(transferAt).toISOString() : null,
      p_head_name: headName.trim() || null
    })
    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setMessage({ type: 'success', text: `Moved ${quantity} to ${destBranch}. Head: ${headName.trim() || profile.full_name}. Snapshot: had ${src.quantity}, left ${src.quantity - Number(quantity)}.` })
      setQuantity('')
      setHeadName('')
      loadItems(itemType, isAdmin)
      loadHistory(isAdmin)
    }
    setSaving(false)
  }

  if (!profile) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  const byDay = {}
  transfers.forEach(t => {
    const day = toDayStr(new Date(t.transfer_date))
    byDay[day] = byDay[day] || []
    byDay[day].push(t)
  })
  const days = Object.keys(byDay).sort().reverse()

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">🚚 Branch Transfers</h1>
          <p className="text-slate-400 text-sm">Move stock between branches — every move logged with who headed it</p>
        </div>
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
      </header>

      {message && (
        <div className={`mb-4 max-w-3xl rounded-lg p-3 text-sm ${message.type === 'success' ? 'bg-green-900/50 text-green-200 border border-green-700' : 'bg-red-900/50 text-red-200 border border-red-700'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-slate-800 rounded-xl p-6 space-y-5 max-w-3xl mb-10">
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
          <label className="block text-sm font-medium text-slate-300 mb-1">1. Move FROM which branch? *</label>
          <select value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setSourceId('') }}
            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2">
            {BRANCH_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <p className="text-xs text-slate-500 mt-1">Only stock at this branch appears in the list below.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">2. Stock to move *</label>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} required
            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2">
            <option value="">-- Choose batch --</option>
            {visibleItems.map(i => (
              <option key={i.id} value={i.id}>
                {itemType === 'raw'
                  ? `${i.category} ${i.gauge || ''} ${i.size_dimensions || ''} — ${i.quantity} ${i.unit} available`
                  : `${i.name} ${i.gauge || ''} ${i.size_dimensions || ''} — ${i.quantity} ${i.unit} available`}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">3. Move TO *</label>
            <select value={destBranch} onChange={(e) => setDestBranch(e.target.value)}
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2">
              {destOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Quantity *</label>
            <input type="number" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} required
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2" placeholder="e.g. 150" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Date & time of transfer</label>
            <input type="datetime-local" value={transferAt} onChange={(e) => setTransferAt(e.target.value)}
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Who is head of this transfer?</label>
          <input value={headName} onChange={(e) => setHeadName(e.target.value)}
            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2"
            placeholder={`The person physically moving the goods (blank = ${profile.full_name})`} />
        </div>

        {src && quantity && (
          <div className="bg-slate-900 rounded-lg p-3 text-sm text-slate-300 border border-slate-700">
            📸 Snapshot: <span className="font-bold text-white">{src.quantity}</span> at {src.current_branch} → move <span className="font-bold text-amber-400">{quantity}</span> → <span className="font-bold text-white">{src.quantity - Number(quantity)}</span> left behind
          </div>
        )}

        <button type="submit" disabled={saving}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-bold text-sm py-3 rounded-lg">
          {saving ? 'Moving...' : 'Transfer Stock'}
        </button>
      </form>

      <h2 className="text-lg font-bold text-white mb-4">🚚 Transfer Reports (per day, full details)</h2>
      <div className="space-y-8 max-w-5xl">
        {days.length === 0 && (
          <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500">No transfers yet.</div>
        )}
        {days.map(day => (
          <div key={day}>
            <h3 className="text-sm font-black text-amber-400 uppercase tracking-wide mb-2">
              📅 {day} · {byDay[day].length} transfer(s) · {byDay[day].reduce((s, t) => s + Number(t.quantity), 0)} pieces moved
            </h3>
            <div className="overflow-x-auto bg-slate-800 rounded-xl border border-slate-700">
              <table className="w-full min-w-[860px] text-sm text-left text-slate-300">
                <thead className="bg-slate-700/50 text-slate-200 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Route</th>
                    <th className="px-4 py-3">Moved</th>
                    <th className="px-4 py-3">Had → Left</th>
                    <th className="px-4 py-3">Head of transfer</th>
                    <th className="px-4 py-3">Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {byDay[day].map(t => (
                    <tr key={t.id} className="border-t border-slate-700">
                      <td className="px-4 py-3 whitespace-nowrap">{new Date(t.transfer_date).toLocaleTimeString()}</td>
                      <td className="px-4 py-3 font-semibold text-white whitespace-nowrap">{t.item_label || `#${t.item_id}`}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {t.source_branch || '—'} → <span className="text-amber-400 font-bold">{t.destination_branch}</span>
                      </td>
                      <td className="px-4 py-3 font-bold text-white">{t.quantity}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {t.qty_before != null
                          ? <span>{t.qty_before} → <span className="font-bold text-amber-400">{t.qty_after}</span></span>
                          : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{t.head_name || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {isAdmin ? (userMap[t.transferred_by]?.full_name || '—') : 'staff'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-3 max-w-5xl">↔️ Swipe/scroll the table sideways to see every column clearly.</p>
    </main>
  )
}