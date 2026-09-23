'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function AlertsPage() {
  const [profile, setProfile] = useState(null)
  const [feed, setFeed] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [loading, setLoading] = useState(true)

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

      const events = []

      const { data: sales } = await supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(100)
      ;(sales || []).forEach(s => {
        if (s.payment_status !== 'paid') {
          const bal = Number(s.total_amount) - Number(s.amount_paid) - (Number(s.adjustments) || 0)
          if (bal <= 0.009) return
          events.push({
            key: 'sale-' + s.id, time: s.created_at, icon: '💳', tone: 'red',
            title: `Credit sale: ${s.customer_name} owes ${bal.toLocaleString()} UGX`,
            context: `Took ${s.quantity} × ${s.item_label || 'item'} · total ${Number(s.total_amount).toLocaleString()} · paid ${Number(s.amount_paid).toLocaleString()} · status ${s.payment_status}`,
            link: `/sales-report?customer=${encodeURIComponent(s.customer_name)}`, linkLabel: 'Open customer debt page'
          })
        }
      })

      const { data: banks } = await supabase.from('bankings').select('*').order('created_at', { ascending: false }).limit(100)
      ;(banks || []).forEach(b => {
        if (b.status === 'pending') {
          events.push({
            key: 'bank-' + b.id, time: b.created_at, icon: b.flagged ? '🚨' : '🏦', tone: b.flagged ? 'red' : 'amber',
            title: b.flagged
              ? `FLAGGED banking of ${Number(b.amount_banked).toLocaleString()} (variance ${Number(b.variance).toLocaleString()}) awaits confirmation`
              : `Banking of ${Number(b.amount_banked).toLocaleString()} awaits your confirmation`,
            context: `Method: ${b.bank_or_method || '—'} · banking date ${b.banking_date} · expected ${Number(b.expected_amount ?? 0).toLocaleString()} · variance ${Number(b.variance ?? 0).toLocaleString()}`,
            link: `/cashbook?day=${b.banking_date}`, linkLabel: 'Open that day\'s cash story'
          })
        }
      })

      const { data: runs } = await supabase.from('production_log').select('*').order('created_at', { ascending: false }).limit(100)
      ;(runs || []).forEach(r => {
        if (Number(r.boss_expected_yield) !== Number(r.actual_yield)) {
          events.push({
            key: 'run-' + r.id, time: r.created_at, icon: '🏭', tone: 'red',
            title: `Production off-standard: expected ${r.boss_expected_yield}, got ${r.actual_yield} — ${r.employee_name || 'staff'}`,
            context: `Raw units used: ${r.raw_units_used ?? '—'} · scrap ${r.scrap_generated || 0} kg · difference ${Number(r.actual_yield) - Number(r.boss_expected_yield)}`,
            link: `/production-report?run=${r.id}`, linkLabel: 'Open the flagged run'
          })
        }
      })

      const { data: counts } = await supabase.from('stocktakes').select('*').order('count_date', { ascending: false }).limit(100)
      ;(counts || []).forEach(c => {
        if (Number(c.difference) !== 0) {
          events.push({
            key: 'count-' + c.id, time: c.count_date, icon: '📋', tone: 'red',
            title: `Stocktake difference ${Number(c.difference) > 0 ? '+' : ''}${c.difference} — counted by ${c.counter_name || 'staff'}`,
            context: `${c.item_label || 'Item'} · system ${c.system_quantity} vs physical ${c.physical_quantity}${c.notes ? ' · 📝 ' + c.notes : ''}`,
            link: `/inventory/history?id=${c.item_id}&type=${c.item_type}`, linkLabel: 'Open item lifecycle'
          })
        }
      })

      const { data: transfers } = await supabase.from('branch_transfers').select('*').order('transfer_date', { ascending: false }).limit(100)
      ;(transfers || []).forEach(t => {
        events.push({
          key: 'transfer-' + t.id, time: t.transfer_date, icon: '🚚', tone: 'blue',
          title: `Stock moved: ${t.quantity} pieces to ${t.destination_branch}`,
          context: `${t.item_label || 'Item'} · ${t.source_branch || '—'} → ${t.destination_branch} · had ${t.qty_before ?? '—'} → left ${t.qty_after ?? '—'} · head: ${t.head_name || '—'}`,
          link: `/inventory/history?id=${t.item_id}&type=${t.item_type}`, linkLabel: 'Open item lifecycle'
        })
      })

      const { data: exps } = await supabase.from('expenses').select('*').order('created_at', { ascending: false }).limit(100)
      ;(exps || []).forEach(e => {
        const day = toDayStr(new Date(e.created_at))
        events.push({
          key: 'exp-' + e.id, time: e.created_at, icon: '💸', tone: 'amber',
          title: `Expense: ${e.description} — ${Number(e.amount).toLocaleString()} UGX`,
          context: `Category: ${e.category}`,
          link: `/cashbook?day=${day}`, linkLabel: 'Open that day\'s cash story'
        })
      })

      events.sort((a, b) => new Date(b.time) - new Date(a.time))
      setFeed(events.slice(0, 100))
      setLoading(false)
    }
    load()
  }, [])

  const toneClass = (tone) =>
    tone === 'red' ? 'border-red-500/40 bg-red-900/10'
    : tone === 'amber' ? 'border-amber-500/40 bg-amber-900/10'
    : 'border-slate-700 bg-slate-800'

  if (!profile) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
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

  const now = new Date()
  const todayStr = toDayStr(now)
  const yestStr = toDayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))

  const byDay = {}
  feed.forEach(e => {
    const day = toDayStr(new Date(e.time))
    byDay[day] = byDay[day] || []
    byDay[day].push(e)
  })
  const days = Object.keys(byDay).sort().reverse()

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">🔔 Activity & Alerts</h1>
          <p className="text-slate-400 text-sm">Grouped by day — tap any alert for the full story</p>
        </div>
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
      </header>

      <div className="max-w-3xl space-y-8">
        {days.length === 0 && <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500">No activity yet.</div>}
        {days.map(day => (
          <div key={day}>
            <h3 className="text-sm font-black text-amber-400 uppercase tracking-wide mb-3">
              {day === todayStr ? '📍 Today' : day === yestStr ? '📍 Yesterday' : `📅 ${day}`} · {byDay[day].length} event(s)
            </h3>
            <div className="space-y-3">
              {byDay[day].map(e => (
                <div key={e.key} className={`rounded-xl border ${toneClass(e.tone)}`}>
                  <button onClick={() => setExpanded(expanded === e.key ? null : e.key)}
                    className="w-full text-left p-4">
                    <p className="text-sm font-bold text-white">
                      <span className="mr-2">{e.icon}</span>{e.title}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-2">{new Date(e.time).toLocaleString()} · {expanded === e.key ? 'tap to collapse ▲' : 'tap for context ▼'}</p>
                  </button>
                  {expanded === e.key && (
                    <div className="px-4 pb-4">
                      <p className="text-xs text-slate-300 bg-slate-900/50 rounded-lg p-3">{e.context}</p>
                      <Link href={e.link} className="inline-block mt-3 text-xs font-bold bg-amber-500 text-slate-900 px-3 py-2 rounded-lg hover:bg-amber-400">
                        → {e.linkLabel}
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}