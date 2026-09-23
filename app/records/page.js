'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const TABS = [
  { key: 'transfers', label: '🚚 Transfers' },
  { key: 'counts', label: '📋 Count differences' },
  { key: 'bankings', label: '🏦 Banking variances' },
  { key: 'production', label: '🏭 Production losses' },
  { key: 'credit', label: '💳 Credit sales' },
  { key: 'corrections', label: '🛠️ Corrections & deletes' }
]

export default function RecordsPage() {
  const [profile, setProfile] = useState(null)
  const [tab, setTab] = useState('transfers')
  const [transfers, setTransfers] = useState([])
  const [counts, setCounts] = useState([])
  const [bankings, setBankings] = useState([])
  const [runs, setRuns] = useState([])
  const [sales, setSales] = useState([])
  const [corrections, setCorrections] = useState([])
  const [userMap, setUserMap] = useState({})
  const [fgMap, setFgMap] = useState({})
  const [loading, setLoading] = useState(true)

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        window.location.href = '/login'
        return
      }
      const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
      setProfile(prof)
      if (!(prof?.role === 'admin' || prof?.role === 'super_admin')) {
        setLoading(false)
        return
      }
      const [t, c, b, r, s, co, u, f] = await Promise.all([
        supabase.from('branch_transfers').select('*').order('transfer_date', { ascending: false }).limit(300),
        supabase.from('stocktakes').select('*').neq('difference', 0).order('count_date', { ascending: false }).limit(300),
        supabase.from('bankings').select('*').neq('variance', 0).order('created_at', { ascending: false }).limit(300),
        supabase.from('production_log').select('*').order('created_at', { ascending: false }).limit(300),
        supabase.from('sales').select('*').neq('payment_status', 'paid').order('created_at', { ascending: false }).limit(300),
        supabase.from('corrections_log').select('*').order('changed_at', { ascending: false }).limit(300),
        supabase.from('users').select('id, full_name'),
        supabase.from('finished_goods').select('id, name, gauge, size_dimensions')
      ])
      setTransfers(t.data || [])
      setCounts(c.data || [])
      setBankings(b.data || [])
      setRuns((r.data || []).filter(x => Number(x.boss_expected_yield) !== Number(x.actual_yield)))
      setSales(s.data || [])
      setCorrections(co.data || [])
      setUserMap(Object.fromEntries((u.data || []).map(x => [x.id, x])))
      setFgMap(Object.fromEntries((f.data || []).map(x => [x.id, x])))
      setLoading(false)
    }
    load()
  }, [])

  if (!profile) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-slate-900 p-6">
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
        <div className="bg-slate-800 rounded-xl p-6 max-w-md mt-8">
          <p className="text-white font-bold">🔒 Management only</p>
        </div>
      </main>
    )
  }

  if (loading) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  const nameOf = (id) => userMap[id]?.full_name || '—'

  const datasets = {
    transfers: transfers.map(t => ({ time: t.transfer_date, body: (
      <div className="space-y-1">
        <p className="font-bold text-white text-base">🚚 {t.item_label || `#${t.item_id}`} — {t.quantity} pieces</p>
        <p className="text-sm text-slate-300">{t.source_branch || '—'} → <span className="text-amber-400 font-bold">{t.destination_branch}</span> · had {t.qty_before ?? '—'} → left {t.qty_after ?? '—'}</p>
        <p className="text-sm text-slate-400">Head: <span className="text-white font-semibold">{t.head_name || '—'}</span> · Recorded by: <span className="text-white font-semibold">{nameOf(t.transferred_by)}</span></p>
      </div>
    ) })),
    counts: counts.map(c => ({ time: c.count_date, body: (
      <div className="space-y-1">
        <p className="font-bold text-white text-base">📋 {c.item_label || `#${c.item_id}`} — difference <span className="text-red-400">{Number(c.difference) > 0 ? '+' : ''}{c.difference}</span></p>
        <p className="text-sm text-slate-300">System {c.system_quantity} vs physical {c.physical_quantity}</p>
        <p className="text-sm text-slate-400">Counted by: <span className="text-white font-semibold">{c.counter_name || nameOf(c.counted_by)}</span>{c.notes && ` · 📝 ${c.notes}`}</p>
      </div>
    ) })),
    bankings: bankings.map(b => ({ time: b.created_at, body: (
      <div className="space-y-1">
        <p className="font-bold text-white text-base">🏦 Banking {Number(b.amount_banked).toLocaleString()} — variance <span className="text-red-400">{Number(b.variance).toLocaleString()}</span></p>
        <p className="text-sm text-slate-300">Expected {Number(b.expected_amount).toLocaleString()} · {b.bank_or_method || 'no method'} · date {b.banking_date}</p>
        <p className="text-sm text-slate-400">By: <span className="text-white font-semibold">{nameOf(b.recorded_by)}</span> · status {b.status}{b.notes && ` · 📝 ${b.notes}`}</p>
      </div>
    ) })),
    production: runs.map(r => ({ time: r.created_at, body: (
      <div className="space-y-1">
        <p className="font-bold text-white text-base">🏭 {fgMap[r.finished_good_id] ? `${fgMap[r.finished_good_id].name} ${fgMap[r.finished_good_id].size_dimensions || ''}` : `#${r.finished_good_id}`} — expected {r.boss_expected_yield}, got {r.actual_yield}</p>
        <p className="text-sm text-slate-300">Loss/over: <span className={Number(r.actual_yield) < Number(r.boss_expected_yield) ? 'text-red-400 font-bold' : 'text-amber-400 font-bold'}>{Number(r.actual_yield) - Number(r.boss_expected_yield)}</span> · raw units {r.raw_units_used} · scrap {r.scrap_generated || 0} kg</p>
        <p className="text-sm text-slate-400">Ran by: <span className="text-white font-semibold">{r.employee_name || '—'}</span></p>
      </div>
    ) })),
    credit: sales.map(s => ({ time: s.created_at, body: (
      <div className="space-y-1">
        <p className="font-bold text-white text-base">💳 {s.customer_name} — {s.item_label || 'item'} × {s.quantity}</p>
        <p className="text-sm text-slate-300">Total {Number(s.total_amount).toLocaleString()} · paid {Number(s.amount_paid).toLocaleString()} · status {s.payment_status}</p>
        <p className="text-sm text-slate-400">Sold by: <span className="text-white font-semibold">{nameOf(s.sold_by)}</span></p>
      </div>
    ) })),
    corrections: corrections.map(c => ({ time: c.changed_at, body: (
      <div className="space-y-1">
        <p className="font-bold text-white text-base">🛠️ {c.table_name} #{c.row_id} — {c.field_name}</p>
        <p className="text-sm text-slate-300">
          {c.new_value === 'DELETED'
            ? <span className="text-red-400 font-bold">ENTRY DELETED ({c.old_value})</span>
            : <><span className="text-red-400 line-through">{c.old_value}</span> → <span className="text-green-400">{c.new_value}</span></>}
        </p>
        <p className="text-sm text-slate-400">By: <span className="text-white font-semibold">{nameOf(c.changed_by)}</span> · 📝 {c.reason}</p>
      </div>
    ) }))
  }

  const rows = datasets[tab] || []
  const byDay = {}
  rows.forEach(r => {
    const day = toDayStr(new Date(r.time))
    byDay[day] = byDay[day] || []
    byDay[day].push(r)
  })
  const days = Object.keys(byDay).sort().reverse()

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">📚 Records & Discrepancies</h1>
          <p className="text-slate-400 text-sm">The permanent book — everything serious, noted forever, grouped by day</p>
        </div>
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-6 max-w-4xl">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`whitespace-nowrap text-sm font-bold px-4 py-2 rounded-lg border ${tab === t.key ? 'bg-amber-500 border-amber-500 text-slate-900' : 'border-slate-600 text-slate-300 hover:bg-slate-800'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-8 max-w-3xl">
        {days.length === 0 && (
          <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500">Nothing recorded here yet. Clean book! 🎉</div>
        )}
        {days.map(day => (
          <div key={day}>
            <h3 className="text-sm font-black text-amber-400 uppercase tracking-wide mb-2">📅 {day} · {byDay[day].length} record(s)</h3>
            <div className="space-y-3">
              {byDay[day].map((r, i) => (
                <div key={i} className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                  {r.body}
                  <p className="text-xs text-slate-500 mt-2">{new Date(r.time).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}