'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { SYSTEM_BRANCH } from '../../../lib/branch'
import { getSessionProfile } from '../../../lib/sessionCache'
import { moveMeta, fmtQty, fmtSigned, fmtWhen, dayKey, fetchStockTrail, TRAIL_LIMIT } from '../../../lib/stockTrail'

const KINDS = [
  ['all', 'All'],
  ['received', 'Received'],
  ['used_in_production', 'Used in production'],
  ['produced', 'Produced'],
  ['sold', 'Sold'],
  ['stocktake_adjustment', 'Count corrections'],
]

const FLOW = [
  ['📥', 'Receive', 'A delivery adds raw material to stock.'],
  ['🏭', 'Produce', 'Raw sheets used come off raw stock and the goods made are added to Finished Goods.'],
  ['💰', 'Sell', 'A sale takes raw material or finished goods off stock. Make & Sell does both steps at once.'],
  ['📋', 'Count', 'A stocktake corrects any difference between the book and the shelf.'],
]

export default function StockMovementsPage() {
  const [ready, setReady] = useState(false)
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [kind, setKind] = useState('all')
  const [itemKind, setItemKind] = useState('all')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const { session } = await getSessionProfile()
        if (!session) return (window.location.href = '/login')
        const res = await fetchStockTrail(supabase)
        setRows(res.rows)
        setError(res.error)
      } finally {
        setReady(true)
      }
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (kind !== 'all' && r.movement_type !== kind) return false
      if (itemKind !== 'all' && r.item_type !== itemKind) return false
      const day = dayKey(r.created_at)
      if (from && day < from) return false
      if (to && day > to) return false
      if (q) {
        const hay = `${r.item_label || ''} ${r.notes || ''} ${r.recorded_by_name || ''} ${moveMeta(r.movement_type).label}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, kind, itemKind, search, from, to])

  const totals = useMemo(() => {
    const t = { raw: { in: 0, out: 0 }, finished: { in: 0, out: 0 } }
    for (const r of filtered) {
      const bucket = t[r.item_type]
      if (!bucket) continue
      const v = Number(r.quantity_change)
      if (v > 0) bucket.in += v
      else bucket.out += -v
    }
    return t
  }, [filtered])

  const filtersOn = kind !== 'all' || itemKind !== 'all' || search || from || to
  const clearFilters = () => { setKind('all'); setItemKind('all'); setSearch(''); setFrom(''); setTo('') }

  if (!ready) return <main className="page-wrap text-muted">Loading stock movements...</main>

  const chip = (active) => `rounded-full border px-3 py-1.5 text-xs font-bold ${active ? 'border-amber-500 bg-amber-500 text-slate-950' : 'border-[var(--line)] text-muted'}`

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p>
          <h1 className="page-title">Stock Movements</h1>
          <p className="page-subtitle">Every addition and deduction, newest first. Nothing changes stock without a line here.</p>
        </div>
        <Link href="/inventory" className="btn-secondary rounded-xl px-3 py-2 text-sm font-bold">Inventory</Link>
      </div>

      <details className="mb-6 max-w-3xl rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
        <summary className="cursor-pointer text-sm font-black">How stock moves <span className="font-medium text-muted">— receive, produce, sell, count</span></summary>
        <ol className="mt-3 space-y-2.5">
          {FLOW.map(([icon, title, text], i) => (
            <li key={title} className="text-xs leading-5 text-muted"><strong className="text-[var(--text)]">{i + 1}. {icon} {title}.</strong> {text}</li>
          ))}
        </ol>
      </details>

      {error && <div className="mb-5 max-w-3xl rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-500">Could not load stock movements: {error}</div>}

      {!error && <>
        <div className="mb-5 grid max-w-3xl gap-3 sm:grid-cols-2">
          <div className="page-card p-4">
            <p className="text-xs font-black uppercase tracking-wide text-muted">Raw materials{filtersOn ? ' (filtered)' : ''}</p>
            <p className="mt-2 text-sm"><span className="font-black text-green-600">+{fmtQty(totals.raw.in)}</span> <span className="text-muted">added</span> · <span className="font-black text-red-600">−{fmtQty(totals.raw.out)}</span> <span className="text-muted">taken off</span></p>
          </div>
          <div className="page-card p-4">
            <p className="text-xs font-black uppercase tracking-wide text-muted">Finished goods{filtersOn ? ' (filtered)' : ''}</p>
            <p className="mt-2 text-sm"><span className="font-black text-green-600">+{fmtQty(totals.finished.in)}</span> <span className="text-muted">added</span> · <span className="font-black text-red-600">−{fmtQty(totals.finished.out)}</span> <span className="text-muted">taken off</span></p>
          </div>
        </div>

        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Movement type">
            {KINDS.map(([value, label]) => <button key={value} type="button" onClick={() => setKind(value)} className={chip(kind === value)}>{label}</button>)}
          </div>
          <div className="flex gap-2" role="group" aria-label="Stock type">
            {[['all', 'Raw + finished'], ['raw', 'Raw only'], ['finished', 'Finished only']].map(([value, label]) => <button key={value} type="button" onClick={() => setItemKind(value)} className={chip(itemKind === value)}>{label}</button>)}
          </div>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item, customer, run #, sale #" aria-label="Search stock movements" className="input-base w-full max-w-3xl" />
          <div className="grid max-w-md grid-cols-2 items-end gap-3">
            <label className="text-xs font-bold text-muted">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-base mt-1 block w-full" /></label>
            <label className="text-xs font-bold text-muted">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-base mt-1 block w-full" /></label>
          </div>
          {filtersOn && <button type="button" onClick={clearFilters} className="text-xs font-bold text-amber-500 underline">Clear filters</button>}
        </div>

        <p className="mb-3 text-xs text-muted">
          {filtered.length} movement{filtered.length === 1 ? '' : 's'}{filtersOn ? ` of ${rows.length}` : ''}
          {rows.length >= TRAIL_LIMIT ? ` · showing the latest ${TRAIL_LIMIT}` : ''}
        </p>

        <div className="max-w-3xl space-y-3">
          {filtered.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">{rows.length === 0 ? 'No stock movements recorded yet.' : 'No movements match these filters.'}</div>}
          {filtered.map((r) => {
            const style = moveMeta(r.movement_type)
            const positive = Number(r.quantity_change) >= 0
            return (
              <article key={r.id} className={`rounded-xl border p-4 ${style.card}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-xs font-black uppercase tracking-wide ${style.accent}`}>
                      {style.icon} {style.label}
                      <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[10px] text-[var(--text)]">{r.item_type === 'raw' ? 'RAW' : 'FINISHED'}</span>
                    </p>
                    <p className="mt-1 break-words font-black">
                      <Link href={`/inventory/history?id=${r.item_id}&type=${r.item_type}`} className="underline decoration-dotted underline-offset-2">{r.item_label}</Link>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-lg font-black ${positive ? 'text-green-600' : 'text-red-600'}`}>{fmtSigned(r.quantity_change)} <span className="text-xs font-bold text-muted">{r.unit}</span></p>
                    <p className="text-xs text-muted">balance {fmtQty(r.balance_after)}</p>
                  </div>
                </div>
                {r.notes && <p className="mt-2 break-words text-sm font-medium leading-5 text-[var(--text)]">{r.notes}</p>}
                <p className="mt-2 text-xs font-medium text-muted">{r.recorded_by_name ? `${r.recorded_by_name} · ` : ''}{fmtWhen(r.created_at)}</p>
              </article>
            )
          })}
        </div>
      </>}
    </main>
  )
}
