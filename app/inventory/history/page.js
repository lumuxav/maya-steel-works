'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { SYSTEM_BRANCH, isSystemBranch } from '../../../lib/branch'

const MOVE_STYLE = {
  received: { icon: '📥', card: 'border-green-500/35 bg-green-500/10', accent: 'text-green-600' },
  sold: { icon: '💰', card: 'border-amber-500/35 bg-amber-500/10', accent: 'text-amber-600' },
  used_in_production: { icon: '🏭', card: 'border-purple-500/35 bg-purple-500/10', accent: 'text-purple-600' },
  produced: { icon: '✅', card: 'border-blue-500/35 bg-blue-500/10', accent: 'text-blue-600' },
  stocktake_adjustment: { icon: '📋', card: 'border-red-500/35 bg-red-500/10', accent: 'text-red-600' }
}

export default function HistoryPage() {
  const [profile, setProfile] = useState(null)
  const [itemType, setItemType] = useState('raw')
  const [item, setItem] = useState(null)
  const [moves, setMoves] = useState([])
  const [outsideBranch, setOutsideBranch] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    const type = params.get('type') || 'raw'
    setItemType(type)

    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return (window.location.href = '/login')
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
      const { data: mv } = await supabase.from('stock_movements').select('*').eq('item_type', type).eq('item_id', id).order('created_at', { ascending: true })
      setMoves((mv || []).filter(m => !String(m.movement_type || '').startsWith('transfer_')))
    }
    load()
  }, [])

  if (!profile) return <main className="page-wrap text-muted">Loading lifecycle...</main>
  if (outsideBranch) return <main className="page-wrap"><div className="page-card max-w-xl p-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="mt-2 text-xl font-black">Item not available in this system</h1><p className="mt-2 text-sm text-muted">This installation only displays Maya Branch stock and activity.</p><Link href="/inventory" className="mt-4 inline-block rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-black text-slate-950">Back to inventory</Link></div></main>

  const label = item ? (itemType === 'raw' ? `${item.category} ${item.gauge || ''} ${item.size_dimensions || ''}`.trim() : `${item.name} ${item.gauge || ''} ${item.size_dimensions || ''}`.trim()) : '...'

  return <main className="page-wrap">
    <div className="page-header-row"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Lifecycle Report</h1><p className="page-subtitle">{label}</p></div><Link href="/inventory" className="btn-secondary rounded-xl px-3 py-2 text-sm font-bold">Inventory</Link></div>
    {item && <div className="page-card mb-6 max-w-2xl p-4"><div className="flex flex-wrap gap-5 text-sm"><span className="text-muted">Current stock: <strong className="text-amber-500">{item.quantity} {item.unit}</strong></span><span className="text-muted">Location: <strong className="text-[var(--text)]">{SYSTEM_BRANCH}</strong></span><span className="text-muted">Events: <strong className="text-[var(--text)]">{moves.length}</strong></span></div></div>}
    <div className="max-w-2xl space-y-3">{moves.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No Maya Branch movements recorded for this batch.</div>}{moves.map(m => { const style = MOVE_STYLE[m.movement_type] || { icon: '•', card: 'border-[var(--line)] bg-[var(--panel)]', accent: 'text-accent' }; const positive = Number(m.quantity_change) >= 0; return <div key={m.id} className={`rounded-xl border p-4 ${style.card}`}><div className="flex items-center justify-between gap-3"><p className={`text-xs font-black uppercase tracking-wide ${style.accent}`}>{style.icon} {String(m.movement_type).replace(/_/g,' ')}</p><p className={`text-lg font-black ${positive ? 'text-green-600' : 'text-red-600'}`}>{Number(m.quantity_change) > 0 ? '+' : ''}{m.quantity_change}</p></div>{m.notes && <p className="mt-2 text-sm font-medium leading-5 text-[var(--text)]">{m.notes}</p>}<p className="mt-2 text-xs font-medium text-muted">{new Date(m.created_at).toLocaleString()}</p></div>})}</div>
  </main>
}
