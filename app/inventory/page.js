'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { SYSTEM_BRANCH, isSystemBranch } from '../../lib/branch'
import { getSessionProfile } from '../../lib/sessionCache'
import { fmtQty } from '../../lib/stockTrail'

const groupKey = (item, type) => type === 'raw'
  ? `${item.category}|${item.gauge || ''}|${item.size_dimensions || ''}`
  : `${item.name}|${item.gauge || ''}|${item.size_dimensions || ''}`

const groupLabel = (item, type) => type === 'raw'
  ? `${item.category} ${item.gauge || ''} ${item.size_dimensions || ''}`.trim()
  : `${item.name} ${item.gauge || ''} ${item.size_dimensions || ''}`.trim()

function buildGroups(items, type) {
  const groups = {}
  items.forEach(item => {
    const key = groupKey(item, type)
    if (!groups[key]) groups[key] = { key, label: groupLabel(item, type), unit: item.unit, totalQty: 0, batches: [] }
    groups[key].totalQty += Number(item.quantity)
    groups[key].batches.push(item)
  })
  const all = Object.values(groups)
  return {
    active: all.filter(g => g.totalQty > 0).sort((a, b) => b.totalQty - a.totalQty),
    outOfStock: all.filter(g => g.totalQty <= 0).sort((a, b) => a.label.localeCompare(b.label)),
  }
}

export default function InventoryPage() {
  const [profile, setProfile] = useState(null)
  const [itemType, setItemType] = useState('raw')
  const [rawItems, setRawItems] = useState([])
  const [finishedItems, setFinishedItems] = useState([])
  const [expandedGroup, setExpandedGroup] = useState(null)
  const [showGoodsOver, setShowGoodsOver] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const { session, profile: prof } = await getSessionProfile()
        if (!session) return (window.location.href = '/login')
        // /inventory?tab=finished opens on Finished Goods (used by the "view in inventory" links)
        if (new URLSearchParams(window.location.search).get('tab') === 'finished') setItemType('finished')
        setProfile(prof)
        const admin = prof?.role === 'admin' || prof?.role === 'super_admin'
        const rawSource = admin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'

        const [{ data: raws }, { data: fins }] = await Promise.all([
          supabase.from(rawSource).select('*').order('created_at', { ascending: false }),
          supabase.from('finished_goods').select('*').order('name'),
        ])

        setRawItems((raws || []).filter(i => isSystemBranch(i.current_branch)))
        setFinishedItems((fins || []).filter(i => isSystemBranch(i.current_branch)))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const switchType = (t) => { setItemType(t); setExpandedGroup(null) }

  const raw = buildGroups(rawItems, 'raw')
  const finished = buildGroups(finishedItems, 'finished')
  const { active, outOfStock } = itemType === 'raw' ? raw : finished
  const finishedPieces = finished.active.reduce((sum, g) => sum + g.totalQty, 0)

  if (!profile || loading) return <main className="page-wrap text-muted">Loading inventory...</main>

  const tabClass = (t) => `rounded-lg py-2.5 text-sm font-bold ${itemType === t ? 'bg-amber-500 text-slate-950' : 'text-muted'}`

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p>
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">Stock physically held at Maya Branch only.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/inventory/ledger" className="btn-secondary rounded-xl px-4 py-2.5 text-sm font-bold">Stock movements</Link>
          <Link href="/deliveries" className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-black text-slate-950">Receive stock</Link>
        </div>
      </div>

      <div className="mb-3 grid max-w-md grid-cols-2 gap-2 rounded-xl bg-[var(--panel)] p-1" role="tablist" aria-label="Stock type">
        <button role="tab" aria-selected={itemType === 'raw'} onClick={() => switchType('raw')} className={tabClass('raw')}>Raw Materials ({raw.active.length})</button>
        <button role="tab" aria-selected={itemType === 'finished'} onClick={() => switchType('finished')} className={tabClass('finished')}>Finished Goods ({finished.active.length})</button>
      </div>
      <p className="mb-6 max-w-xl text-xs leading-5 text-muted">
        {itemType === 'raw'
          ? 'Raw material goes up when a delivery is received and comes down when it is used in production or sold. Goods you have made are under Finished Goods.'
          : `Finished goods go up when a production run is recorded and come down when they are sold${finished.active.length ? ` — ${fmtQty(finishedPieces)} pieces in stock now` : ''}. Open Lifecycle on any batch to see every step.`}
      </p>

      <div className="mb-8 space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-lg font-black">Active stock</h2><span className="text-xs text-muted">{active.length} item types</span></div>
        {active.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">
          {itemType === 'finished'
            ? <>No finished goods in stock. Goods appear here once a production run is recorded on the <Link href="/production" className="font-bold text-amber-500 underline">Production</Link> page and stay until they are sold. <Link href="/inventory/ledger" className="font-bold text-amber-500 underline">See every stock movement →</Link></>
            : `No active stock at ${SYSTEM_BRANCH}.`}
        </div>}
        {active.map(group => {
          const open = expandedGroup === group.key
          return (
            <div key={group.key} className="page-card overflow-hidden">
              <button onClick={() => setExpandedGroup(open ? null : group.key)} className="flex w-full items-center justify-between gap-4 p-4 text-left">
                <div><p className="font-black">{group.label}</p><p className="mt-1 text-xs text-muted">{group.batches.length} batch{group.batches.length === 1 ? '' : 'es'} at Maya Branch</p></div>
                <div className="text-right"><p className="text-2xl font-black text-amber-500">{group.totalQty.toLocaleString()}</p><p className="text-xs text-muted">{group.unit}</p></div>
              </button>
              {open && <div className="border-t border-[var(--line)] p-4 space-y-2">
                {group.batches.map(batch => <div key={batch.id} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--panel-2)] p-3">
                  <div><p className="text-sm font-bold">{Number(batch.quantity).toLocaleString()} {batch.unit}</p><p className="mt-1 text-xs text-muted">{itemType === 'raw' ? 'Received' : 'First made'} {new Date(batch.created_at).toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala' })}</p></div>
                  <Link href={`/inventory/history?id=${batch.id}&type=${itemType}`} className="text-xs font-bold text-amber-500">Lifecycle →</Link>
                </div>)}
              </div>}
            </div>
          )
        })}
      </div>

      {outOfStock.length > 0 && <div>
        <button onClick={() => setShowGoodsOver(v => !v)} className="page-card flex w-full items-center justify-between p-4 text-left"><div><p className="font-black text-red-500">Out of stock</p><p className="mt-1 text-xs text-muted">{outOfStock.length} depleted item types</p></div><span className="text-muted">{showGoodsOver ? 'Hide' : 'Show'}</span></button>
        {showGoodsOver && <div className="mt-3 space-y-2">{outOfStock.map(group => <div key={group.key} className="page-card flex items-center justify-between p-3"><span className="text-sm font-bold">{group.label}</span><span className="text-xs font-black text-red-500">0 {group.unit}</span></div>)}</div>}
      </div>}
    </main>
  )
}
