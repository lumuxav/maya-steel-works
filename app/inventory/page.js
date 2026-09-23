'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

const BRANCHES = ['Maya Branch', 'Mbarara', 'Site / Project']

export default function InventoryPage() {
  const [profile, setProfile] = useState(null)
  const [itemType, setItemType] = useState('raw')
  const [branchView, setBranchView] = useState('Maya Branch')
  const [rawItems, setRawItems] = useState([])
  const [finishedItems, setFinishedItems] = useState([])
  const [expandedGroup, setExpandedGroup] = useState(null)
  const [showGoodsOver, setShowGoodsOver] = useState(false)
  const [loading, setLoading] = useState(true)

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      window.location.href = '/login'
      return
    }
    const { data: prof } = await supabase.from('users').select('full_name, role, branch').eq('id', session.user.id).single()
    setProfile(prof)
    setBranchView(prof?.branch || 'Maya Branch')
    const admin = prof?.role === 'admin' || prof?.role === 'super_admin'

    const rawSource = admin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'
    const { data: raws } = await supabase.from(rawSource).select('*').order('created_at', { ascending: false })
    setRawItems(raws || [])

    const { data: fins } = await supabase.from('finished_goods').select('*').order('name')
    setFinishedItems(fins || [])

    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const switchType = (t) => {
    setItemType(t)
    setExpandedGroup(null)
  }

  // ONLY the selected branch's stock enters the grouping
  const branchItems = (itemType === 'raw' ? rawItems : finishedItems)
    .filter(i => (i.current_branch || 'Maya Branch') === branchView)

  const groupItems = (items) => {
    const groups = {}
    items.forEach(item => {
      const key = itemType === 'raw'
        ? `${item.category}|${item.gauge || ''}|${item.size_dimensions || ''}`
        : `${item.name}|${item.gauge || ''}|${item.size_dimensions || ''}`

      if (!groups[key]) {
        groups[key] = {
          key,
          label: itemType === 'raw'
            ? `${item.category} ${item.gauge || ''} ${item.size_dimensions || ''}`.trim()
            : `${item.name} ${item.gauge || ''} ${item.size_dimensions || ''}`.trim(),
          unit: item.unit,
          totalQty: 0,
          batches: [],
          isOutOfStock: false
        }
      }
      groups[key].totalQty += Number(item.quantity)
      groups[key].batches.push(item)
    })

    const active = []
    const outOfStock = []
    Object.values(groups).forEach(g => {
      if (g.totalQty <= 0) {
        g.isOutOfStock = true
        outOfStock.push(g)
      } else {
        active.push(g)
      }
    })
    active.sort((a, b) => b.totalQty - a.totalQty)
    outOfStock.sort((a, b) => a.label.localeCompare(b.label))
    return { active, outOfStock }
  }

  const { active, outOfStock } = groupItems(branchItems)

  const getBranchColor = (branch) => {
    if (branch?.toLowerCase().includes('mbarara')) return 'bg-blue-500/20 text-blue-300 border-blue-500/40'
    if (branch?.toLowerCase().includes('site')) return 'bg-orange-500/20 text-orange-300 border-orange-500/40'
    return 'bg-green-500/20 text-green-300 border-green-500/40'
  }

  if (!profile || loading) {
    return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>
  }

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">📦 Inventory</h1>
          <p className="text-slate-400 text-sm">Grouped totals with batch-level detail</p>
        </div>
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
      </header>

      {/* BRANCH LENS */}
      <div className="mb-6 max-w-md">
        {isAdmin ? (
          <div>
            <label className="block text-[10px] text-slate-400 uppercase mb-1">Viewing branch (management can switch)</label>
            <select value={branchView} onChange={(e) => { setBranchView(e.target.value); setExpandedGroup(null) }}
              className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm font-bold">
              {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        ) : (
          <div className={`inline-block text-xs font-bold px-3 py-2 rounded-lg border ${getBranchColor(branchView)}`}>
            📍 {branchView} — your branch's stock only
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 bg-slate-800 p-1 rounded-lg mb-6 max-w-md">
        <button onClick={() => switchType('raw')}
          className={`py-2 rounded-md text-sm font-bold transition ${itemType === 'raw' ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}>
          Raw Materials
        </button>
        <button onClick={() => switchType('finished')}
          className={`py-2 rounded-md text-sm font-bold transition ${itemType === 'finished' ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}>
          Finished Goods
        </button>
      </div>

      <div className="space-y-3 mb-8">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500"></span>
          Active Stock at {branchView} ({active.length} item types)
        </h2>

        {active.length === 0 && (
          <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500">No active stock at {branchView}.</div>
        )}

        {active.map(group => {
          const isExpanded = expandedGroup === group.key
          return (
            <div key={group.key} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <button
                onClick={() => setExpandedGroup(isExpanded ? null : group.key)}
                className="w-full p-4 flex items-center justify-between hover:bg-slate-700/50 transition text-left"
              >
                <div>
                  <p className="font-bold text-white text-base">{group.label}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {group.batches.length} batch{group.batches.length > 1 ? 'es' : ''} at this branch
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black text-amber-400">{group.totalQty.toLocaleString()}</p>
                  <p className="text-xs text-slate-400">{group.unit}</p>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-700 bg-slate-900/50 p-4 space-y-3">
                  {group.batches.map(batch => (
                    <div key={batch.id} className="flex items-center justify-between bg-slate-800 rounded-lg p-3 border border-slate-700">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getBranchColor(batch.current_branch)}`}>
                            {batch.current_branch || 'Maya Branch'}
                          </span>
                          <span className="text-xs text-slate-400">
                            Received {new Date(batch.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-white">
                          {batch.quantity.toLocaleString()} {batch.unit}
                          {batch.is_remnant && <span className="text-xs text-amber-400 ml-2">(Remnant)</span>}
                        </p>
                      </div>
                      <Link
                        href={`/inventory/history?id=${batch.id}&type=${itemType}`}
                        className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg font-medium transition"
                      >
                        View Lifecycle
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {outOfStock.length > 0 && (
        <div className="mb-8">
          <button
            onClick={() => setShowGoodsOver(!showGoodsOver)}
            className="w-full flex items-center justify-between bg-slate-800/50 hover:bg-slate-800 rounded-xl p-4 border border-red-500/30 transition"
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">📦</span>
              <div className="text-left">
                <p className="font-bold text-red-400">Goods Over / Out of Stock ({branchView})</p>
                <p className="text-xs text-slate-400">{outOfStock.length} item types depleted</p>
              </div>
            </div>
            <span className="text-slate-400">{showGoodsOver ? '▲ Hide' : '▼ Show'}</span>
          </button>

          {showGoodsOver && (
            <div className="mt-3 space-y-2">
              {outOfStock.map(group => (
                <div key={group.key} className="bg-slate-800 rounded-lg border border-red-500/20 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-slate-300">{group.label}</p>
                    <span className="text-xs font-bold text-red-400 bg-red-500/10 px-2 py-1 rounded">0 {group.unit}</span>
                  </div>
                  <div className="space-y-2">
                    {group.batches.map(batch => (
                      <div key={batch.id} className="flex items-center justify-between bg-slate-900/50 rounded p-2 text-xs">
                        <span className="text-slate-400">
                          Received {new Date(batch.created_at).toLocaleDateString()}
                        </span>
                        <Link
                          href={`/inventory/history?id=${batch.id}&type=${itemType}`}
                          className="text-amber-400 hover:text-amber-300 font-medium"
                        >
                          See how it finished →
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  )
}