'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

const FIELDS = {
  sales: ['quantity', 'unit_price', 'total_amount', 'amount_paid', 'customer_name', 'payment_status'],
  expenses: ['description', 'category', 'amount'],
  bankings: ['amount_banked', 'banking_date', 'bank_or_method']
}
const NUMERIC = ['quantity', 'unit_price', 'total_amount', 'amount_paid', 'amount', 'amount_banked']
const norm = (k, v) => NUMERIC.includes(k)
  ? (v === '' || v === null || v === undefined ? 0 : Number(v))
  : (v ?? '')

const toDayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function CorrectionsPage() {
  const [profile, setProfile] = useState(null)
  const [userId, setUserId] = useState(null)
  const [tab, setTab] = useState('sales')
  const [rows, setRows] = useState([])
  const [audit, setAudit] = useState([])
  const [userMap, setUserMap] = useState({})
  const [dayFilter, setDayFilter] = useState('all')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      window.location.href = '/login'
      return
    }
    setUserId(session.user.id)
    const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
    setProfile(prof)
    if (!(prof?.role === 'admin' || prof?.role === 'super_admin')) {
      setLoading(false)
      return
    }
    const { data: r } = await supabase.from(tab).select('*').order('created_at', { ascending: false }).limit(100)
    setRows(r || [])
    const { data: a } = await supabase.from('corrections_log').select('*').order('changed_at', { ascending: false }).limit(80)
    setAudit(a || [])
    const { data: users } = await supabase.from('users').select('id, full_name')
    setUserMap(Object.fromEntries((users || []).map(u => [u.id, u])))
    setLoading(false)
  }

  useEffect(() => { load() }, [tab])

  const summary = (row) => {
    if (tab === 'sales') return `${row.item_label || 'item'} x${row.quantity} · ${row.customer_name} · ${row.total_amount}`
    if (tab === 'expenses') return `${row.description} · ${row.category} · ${row.amount}`
    return `${row.amount_banked} · ${row.banking_date}`
  }

  const startEdit = (row) => {
    setEditing(row.id)
    const f = {}
    FIELDS[tab].forEach(k => { f[k] = row[k] ?? '' })
    setForm(f)
    setReason('')
  }

  const saveEdit = async () => {
    const row = rows.find(r => r.id === editing)
    const changes = []
    FIELDS[tab].forEach(k => {
      const oldV = norm(k, row[k])
      const newV = norm(k, form[k])
      if (String(oldV) !== String(newV)) changes.push({ field: k, oldV, newV })
    })
    if (changes.length === 0) {
      setMessage({ type: 'error', text: 'Nothing changed.' })
      return
    }
    if (!reason.trim()) {
      setMessage({ type: 'error', text: 'A reason is required — it goes into the permanent audit trail.' })
      return
    }
    const payload = {}
    changes.forEach(c => { payload[c.field] = c.newV })
    const { error } = await supabase.from(tab).update(payload).eq('id', editing)
    if (error) {
      setMessage({ type: 'error', text: error.message })
      return
    }
    for (const c of changes) {
      await supabase.from('corrections_log').insert({
        table_name: tab, row_id: editing, field_name: c.field,
        old_value: String(c.oldV), new_value: String(c.newV),
        reason: reason.trim(), changed_by: userId
      })
    }
    setMessage({ type: 'success', text: `Corrected ${changes.length} field(s) on ${tab} #${editing}. Logged permanently.` })
    setEditing(null)
    load()
  }

  const deleteRow = async (row) => {
    const why = window.prompt(`Why delete ${tab} #${row.id}? (this goes into the permanent audit trail)`)
    if (!why || !why.trim()) return
    const { error } = await supabase.from(tab).delete().eq('id', row.id)
    if (error) {
      setMessage({ type: 'error', text: error.message })
      return
    }
    await supabase.from('corrections_log').insert({
      table_name: tab, row_id: row.id, field_name: '(whole entry deleted)',
      old_value: summary(row), new_value: 'DELETED',
      reason: why.trim(), changed_by: userId
    })
    setMessage({ type: 'success', text: `${tab} #${row.id} deleted. Deletion logged permanently.` })
    load()
  }

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

  const allDays = Array.from(new Set(rows.map(r => toDayStr(new Date(r.created_at))))).sort().reverse()
  const filtered = dayFilter === 'all' ? rows : rows.filter(r => toDayStr(new Date(r.created_at)) === dayFilter)
  const byDay = {}
  filtered.forEach(r => {
    const d = toDayStr(new Date(r.created_at))
    byDay[d] = byDay[d] || []
    byDay[d].push(r)
  })
  const days = Object.keys(byDay).sort().reverse()

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">🛠️ Corrections</h1>
          <p className="text-slate-400 text-sm">Edit or delete wrong entries — every action logged old → new with your name</p>
        </div>
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
      </header>

      {message && (
        <div className={`mb-4 max-w-3xl rounded-lg p-3 text-sm ${message.type === 'success' ? 'bg-green-900/50 text-green-200 border border-green-700' : 'bg-red-900/50 text-red-200 border border-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 bg-slate-800 p-1 rounded-lg mb-4 max-w-md">
        {['sales', 'expenses', 'bankings'].map(t => (
          <button key={t} onClick={() => { setTab(t); setEditing(null); setDayFilter('all') }}
            className={`py-2 rounded-md text-sm font-bold capitalize ${tab === t ? 'bg-amber-500 text-slate-900' : 'text-slate-400'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-6 max-w-3xl">
        <button onClick={() => setDayFilter('all')}
          className={`whitespace-nowrap text-xs font-bold px-3 py-2 rounded-lg border ${dayFilter === 'all' ? 'bg-amber-500 border-amber-500 text-slate-900' : 'border-slate-600 text-slate-300'}`}>
          All days
        </button>
        {allDays.map(d => (
          <button key={d} onClick={() => setDayFilter(d)}
            className={`whitespace-nowrap text-xs font-bold px-3 py-2 rounded-lg border ${dayFilter === d ? 'bg-amber-500 border-amber-500 text-slate-900' : 'border-slate-600 text-slate-300'}`}>
            {d}
          </button>
        ))}
      </div>

      <div className="space-y-6 max-w-3xl mb-10">
        {days.length === 0 && <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500">No entries for this selection.</div>}
        {days.map(day => (
          <div key={day}>
            <h3 className="text-sm font-black text-amber-400 uppercase tracking-wide mb-2">📅 {day} · {byDay[day].length} entr(y/ies)</h3>
            <div className="space-y-3">
              {byDay[day].map(row => (
                <div key={row.id} className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                  {editing === row.id ? (
                    <div className="space-y-3">
                      {FIELDS[tab].map(k => (
                        <div key={k}>
                          <label className="block text-[10px] text-slate-400 uppercase mb-1">{k.replace(/_/g, ' ')}</label>
                          <input value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" />
                        </div>
                      ))}
                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase mb-1">Reason for correction *</label>
                        <input value={reason} onChange={(e) => setReason(e.target.value)}
                          className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm"
                          placeholder="e.g. employee typed 800 instead of 80" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={saveEdit} className="bg-green-500 hover:bg-green-400 text-slate-900 font-bold text-sm px-4 py-2 rounded-lg">Save Correction</button>
                        <button onClick={() => setEditing(null)} className="bg-slate-700 text-white font-bold text-sm px-4 py-2 rounded-lg">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-xs text-slate-300 space-y-1">
                        <p className="font-bold text-white">#{row.id} · {new Date(row.created_at).toLocaleString()}</p>
                        {tab === 'sales' && <p>{row.item_label || 'item'} × {row.quantity} · {row.customer_name} · total {Number(row.total_amount).toLocaleString()} · paid {Number(row.amount_paid).toLocaleString()} ({row.payment_status})</p>}
                        {tab === 'expenses' && <p>{row.description} · {row.category} · {Number(row.amount).toLocaleString()}</p>}
                        {tab === 'bankings' && <p>{Number(row.amount_banked).toLocaleString()} · {row.banking_date} · {row.bank_or_method || '—'} · {row.status}{row.flagged ? ' ⚠️' : ''}</p>}
                      </div>
                      <div className="flex flex-col gap-2">
                        <button onClick={() => startEdit(row)} className="text-xs bg-blue-500 hover:bg-blue-400 text-slate-900 font-bold px-3 py-2 rounded-lg whitespace-nowrap">
                          🛠️ Edit
                        </button>
                        <button onClick={() => deleteRow(row)} className="text-xs bg-red-500 hover:bg-red-400 text-white font-bold px-3 py-2 rounded-lg whitespace-nowrap">
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-bold text-white mb-3">📜 Correction Audit Trail</h2>
      <div className="space-y-2 max-w-3xl">
        {audit.length === 0 && <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500">No corrections yet.</div>}
        {audit.map(a => (
          <div key={a.id} className={`rounded-lg border p-3 text-xs ${a.new_value === 'DELETED' ? 'border-red-500/40 bg-red-900/10' : 'border-blue-500/30 bg-slate-800'}`}>
            <p className="text-white font-bold">
              {a.table_name} #{a.row_id} · {a.field_name}:{' '}
              {a.new_value === 'DELETED'
                ? <span className="text-red-400">ENTRY DELETED ({a.old_value})</span>
                : <><span className="text-red-400 line-through">{a.old_value}</span> → <span className="text-green-400">{a.new_value}</span></>}
            </p>
            <p className="text-slate-400 mt-1">
              by {userMap[a.changed_by]?.full_name || '—'} · {new Date(a.changed_at).toLocaleString()} · 📝 {a.reason}
            </p>
          </div>
        ))}
      </div>
    </main>
  )
}