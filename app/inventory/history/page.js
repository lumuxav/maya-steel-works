'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { SYSTEM_BRANCH, isSystemBranch } from '../../../lib/branch'
import { moveMeta, fmtQty, fmtSigned, fmtWhen, withBalances, summarise } from '../../../lib/stockTrail'

export default function HistoryPage() {
  const [profile, setProfile] = useState(null)
  const [itemType, setItemType] = useState('raw')
  const [item, setItem] = useState(null)
  const [moves, setMoves] = useState([])
  const [allMovesSum, setAllMovesSum] = useState(0)
  const [outsideBranch, setOutsideBranch] = useState(false)
  const [users, setUsers] = useState({})

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    const type = params.get('type') || 'raw'

    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return (window.location.href = '/login')
      setItemType(type)
      const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
      setProfile(prof)
      const admin = prof?.role === 'admin' || prof?.role === 'super_admin'

      let itemRow = null
      if (type === 'raw') {
        const source = admin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'
        const { data } = await supabase.from(source).select('*').eq('id', id).single()
        itemRow = data || null
      } else {
        const { data } = await supabase.from('finished_goods').select('*').eq('id', id).single()
        itemRow = data || null
      }

      if (!itemRow || !isSystemBranch(itemRow.current_branch)) {
        setOutsideBranch(true)
        setItem(null)
        setMoves([])
        return
      }

      setItem(itemRow)
      const { data: mv } = await supabase.from('stock_movements').select('*').eq('item_type', type).eq('item_id', id).order('created_at', { ascending: true }).order('id', { ascending: true })
      const everything = mv || []
      // transfers belong to other branches' books, so they are not shown here, but they still
      // count towards the "do the steps add up to the stock" check below
      setAllMovesSum(everything.reduce((sum, m) => sum + Number(m.quantity_change), 0))
      setMoves(everything.filter(m => !String(m.movement_type || '').startsWith('transfer_')))

      const ids = [...new Set(everything.map(m => m.recorded_by).filter(Boolean))]
      if (ids.length) {
        const { data: people } = await supabase.from('users').select('id, full_name').in('id', ids)
        setUsers(Object.fromEntries((people || []).map(p => [p.id, p.full_name])))
      }
    }
    load()
  }, [])

  if (!profile) return <main className="page-wrap text-muted">Loading lifecycle...</main>
  if (outsideBranch) return <main className="page-wrap"><div className="page-card max-w-xl p-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="mt-2 text-xl font-black">Item not available in this system</h1><p className="mt-2 text-sm text-muted">This installation only displays Maya Branch stock and activity.</p><Link href="/inventory" className="mt-4 inline-block rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-black text-slate-950">Back to inventory</Link></div></main>

  const label = item ? (itemType === 'raw' ? `${item.category} ${item.gauge || ''} ${item.size_dimensions || ''}`.trim() : `${item.name} ${item.gauge || ''} ${item.size_dimensions || ''}`.trim()) : '...'
  const timeline = withBalances(moves)
  const stats = item ? summarise(moves, allMovesSum, item.quantity) : null

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Lifecycle Report</h1><p className="page-subtitle">{label}</p></div>
      <div className="flex flex-wrap gap-2">
        <Link href="/inventory/ledger" className="btn-secondary rounded-xl px-3 py-2 text-sm font-bold">All movements</Link>
        <Link href={itemType === 'finished' ? '/inventory?tab=finished' : '/inventory'} className="btn-secondary rounded-xl px-3 py-2 text-sm font-bold">Inventory</Link>
      </div>
    </div>

    {item && <div className="page-card mb-4 max-w-2xl p-4">
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><p className="text-[11px] font-bold uppercase text-muted">Added</p><p className="mt-1 text-lg font-black text-green-600">+{fmtQty(stats.added)}</p></div>
        <div><p className="text-[11px] font-bold uppercase text-muted">Taken off</p><p className="mt-1 text-lg font-black text-red-600">−{fmtQty(stats.removed)}</p></div>
        <div><p className="text-[11px] font-bold uppercase text-muted">In stock now</p><p className="mt-1 text-lg font-black text-amber-500">{fmtQty(item.quantity)} <span className="text-xs font-bold text-muted">{item.unit}</span></p></div>
        <div><p className="text-[11px] font-bold uppercase text-muted">Steps</p><p className="mt-1 text-lg font-black">{moves.length}</p></div>
      </div>
      <p className="mt-3 text-xs text-muted">Location: <strong className="text-[var(--text)]">{SYSTEM_BRANCH}</strong></p>
    </div>}

    {item && (stats.reconciles
      ? <p className="mb-6 max-w-2xl text-xs font-medium text-green-600">✓ The steps below add up exactly to the stock on the shelf.</p>
      : <div className="mb-6 max-w-2xl rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-600">
          The steps below add up to {fmtQty(allMovesSum)} but the stock shows {fmtQty(item.quantity)} (difference {fmtSigned(stats.diff)}). This item may have been entered or changed before every step was recorded. A stocktake will correct it and leave a line here.
        </div>)}

    <div className="max-w-2xl space-y-3">{timeline.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No Maya Branch movements recorded for this batch.</div>}{timeline.map(m => { const style = moveMeta(m.movement_type); const positive = Number(m.quantity_change) >= 0; return <div key={m.id} className={`rounded-xl border p-4 ${style.card}`}><div className="flex items-center justify-between gap-3"><p className={`text-xs font-black uppercase tracking-wide ${style.accent}`}>{style.icon} {style.label}</p><p className={`text-lg font-black ${positive ? 'text-green-600' : 'text-red-600'}`}>{fmtSigned(m.quantity_change)}</p></div>{m.notes && <p className="mt-2 break-words text-sm font-medium leading-5 text-[var(--text)]">{m.notes}</p>}<div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-muted"><span>{users[m.recorded_by] ? `${users[m.recorded_by]} · ` : ''}{fmtWhen(m.created_at)}</span><span>balance after: <strong className="text-[var(--text)]">{fmtQty(m.balance_after)}</strong></span></div></div>})}</div>
  </main>
}
