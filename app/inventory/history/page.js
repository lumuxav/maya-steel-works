'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'

const MOVE_STYLE = {
  received: { icon: '📥', color: 'border-green-500/40 bg-green-900/10 text-green-300' },
  sold: { icon: '💰', color: 'border-amber-500/40 bg-amber-900/10 text-amber-300' },
  used_in_production: { icon: '🏭', color: 'border-purple-500/40 bg-purple-900/10 text-purple-300' },
  produced: { icon: '✅', color: 'border-blue-500/40 bg-blue-900/10 text-blue-300' },
  transfer_out: { icon: '🚚', color: 'border-orange-500/40 bg-orange-900/10 text-orange-300' },
  transfer_in: { icon: '🚚', color: 'border-blue-500/40 bg-blue-900/10 text-blue-300' },
  stocktake_adjustment: { icon: '📋', color: 'border-red-500/40 bg-red-900/10 text-red-300' }
}

export default function HistoryPage() {
  const [profile, setProfile] = useState(null)
  const [itemId, setItemId] = useState(null)
  const [itemType, setItemType] = useState('raw')
  const [item, setItem] = useState(null)
  const [moves, setMoves] = useState([])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    const type = params.get('type') || 'raw'
    setItemId(id)
    setItemType(type)

    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        window.location.href = '/login'
        return
      }
      const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
      setProfile(prof)
      const admin = prof?.role === 'admin' || prof?.role === 'super_admin'

      if (type === 'raw') {
        const source = admin ? 'raw_materials_admin_view' : 'raw_materials_employee_view'
        const { data } = await supabase.from(source).select('*').eq('id', id).single()
        setItem(data)
      } else {
        const { data } = await supabase.from('finished_goods').select('*').eq('id', id).single()
        setItem(data)
      }

      const { data: mv } = await supabase.from('stock_movements')
        .select('*')
        .eq('item_type', type)
        .eq('item_id', id)
        .order('created_at', { ascending: true })
      setMoves(mv || [])
    }
    load()
  }, [])

  if (!profile) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  const label = item
    ? (itemType === 'raw'
      ? `${item.category} ${item.gauge || ''} ${item.size_dimensions || ''}`.trim()
      : `${item.name} ${item.gauge || ''} ${item.size_dimensions || ''}`.trim())
    : '...'

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-black text-white">📜 Lifecycle Report</h1>
          <p className="text-slate-400 text-sm">{label}</p>
        </div>
        <Link href="/inventory" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Inventory</Link>
      </header>

      {item && (
        <div className="bg-slate-800 rounded-xl p-4 mb-6 border border-slate-700 max-w-2xl">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="text-slate-400">Current stock: <span className="font-bold text-amber-400">{item.quantity} {item.unit}</span></span>
            <span className="text-slate-400">Location: <span className="font-bold text-white">{item.current_branch || 'Maya Branch'}</span></span>
            <span className="text-slate-400">Events: <span className="font-bold text-white">{moves.length}</span></span>
          </div>
        </div>
      )}

      <div className="space-y-3 max-w-2xl">
        {moves.length === 0 && (
          <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500">No movements recorded for this batch.</div>
        )}
        {moves.map(m => {
          const style = MOVE_STYLE[m.movement_type] || { icon: '•', color: 'border-slate-700 bg-slate-800 text-slate-300' }
          return (
            <div key={m.id} className={`rounded-xl border p-4 ${style.color}`}>
              <div className="flex items-center justify-between">
                <p className="font-bold uppercase text-xs tracking-wide">
                  {style.icon} {m.movement_type.replace(/_/g, ' ')}
                </p>
                <p className={`font-black text-lg ${Number(m.quantity_change) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {Number(m.quantity_change) > 0 ? '+' : ''}{m.quantity_change}
                </p>
              </div>
              {m.notes && <p className="text-xs mt-2 opacity-80">{m.notes}</p>}
              <p className="text-[10px] mt-2 opacity-60">{new Date(m.created_at).toLocaleString()}</p>
            </div>
          )
        })}
      </div>
    </main>
  )
}