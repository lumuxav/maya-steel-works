'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SYSTEM_BRANCH, getSystemUserIds } from '../../lib/branch'

const FIELDS = {
  sales: ['quantity', 'unit_price', 'total_amount', 'amount_paid', 'customer_name', 'payment_status'],
  expenses: ['description', 'category', 'amount'],
  bankings: ['amount_banked', 'banking_date', 'bank_or_method']
}
const NUMERIC = ['quantity', 'unit_price', 'total_amount', 'amount_paid', 'amount', 'amount_banked']
const norm = (k, v) => NUMERIC.includes(k) ? (v === '' || v === null || v === undefined ? 0 : Number(v)) : (v ?? '')
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
    if (!session) return (window.location.href = '/login')
    setUserId(session.user.id)
    const { data: prof } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
    setProfile(prof)
    if (!(prof?.role === 'admin' || prof?.role === 'super_admin')) { setLoading(false); return }

    const systemUsers = await getSystemUserIds(supabase)
    const { data: r } = await supabase.from(tab).select('*').order('created_at', { ascending: false }).limit(300)
    const filteredRows = (r || []).filter(row => {
      if (tab === 'sales') return systemUsers.has(row.sold_by)
      if (tab === 'expenses') return systemUsers.has(row.recorded_by)
      return systemUsers.has(row.recorded_by)
    })
    setRows(filteredRows)

    const { data: a } = await supabase.from('corrections_log').select('*').order('changed_at', { ascending: false }).limit(300)
    setAudit((a || []).filter(x => !x.changed_by || systemUsers.has(x.changed_by)))
    const { data: users } = await supabase.from('users').select('id, full_name, branch')
    setUserMap(Object.fromEntries((users || []).filter(u => systemUsers.has(u.id)).map(u => [u.id, u])))
    setLoading(false)
  }

  useEffect(() => { load() }, [tab])

  const summary = (row) => tab === 'sales' ? `${row.item_label || 'item'} x${row.quantity} · ${row.customer_name} · ${row.total_amount}` : tab === 'expenses' ? `${row.description} · ${row.category} · ${row.amount}` : `${row.amount_banked} · ${row.banking_date}`
  const startEdit = (row) => { setEditing(row.id); const f = {}; FIELDS[tab].forEach(k => { f[k] = row[k] ?? '' }); setForm(f); setReason('') }

  const saveEdit = async () => {
    const row = rows.find(r => r.id === editing)
    const changes = []
    FIELDS[tab].forEach(k => { const oldV = norm(k, row[k]), newV = norm(k, form[k]); if (String(oldV) !== String(newV)) changes.push({ field: k, oldV, newV }) })
    if (!changes.length) return setMessage({ type: 'error', text: 'Nothing changed.' })
    if (!reason.trim()) return setMessage({ type: 'error', text: 'A reason is required.' })
    const payload = {}; changes.forEach(c => { payload[c.field] = c.newV })
    const { error } = await supabase.from(tab).update(payload).eq('id', editing)
    if (error) return setMessage({ type: 'error', text: error.message })
    for (const c of changes) await supabase.from('corrections_log').insert({ table_name: tab, row_id: editing, field_name: c.field, old_value: String(c.oldV), new_value: String(c.newV), reason: reason.trim(), changed_by: userId })
    setMessage({ type: 'success', text: `Corrected ${changes.length} field(s).` }); setEditing(null); load()
  }

  const deleteRow = async (row) => {
    const why = window.prompt(`Why delete ${tab} #${row.id}?`)
    if (!why?.trim()) return
    const { error } = await supabase.from(tab).delete().eq('id', row.id)
    if (error) return setMessage({ type: 'error', text: error.message })
    await supabase.from('corrections_log').insert({ table_name: tab, row_id: row.id, field_name: '(whole entry deleted)', old_value: summary(row), new_value: 'DELETED', reason: why.trim(), changed_by: userId })
    setMessage({ type: 'success', text: `${tab} #${row.id} deleted and logged.` }); load()
  }

  if (!profile || loading) return <main className="page-wrap text-muted">Loading corrections...</main>
  if (profile.role !== 'admin' && profile.role !== 'super_admin') return <main className="page-wrap"><div className="page-card max-w-md p-6"><p className="font-black">Management only</p></div></main>

  const allDays = Array.from(new Set(rows.map(r => toDayStr(new Date(r.created_at))))).sort().reverse()
  const filtered = dayFilter === 'all' ? rows : rows.filter(r => toDayStr(new Date(r.created_at)) === dayFilter)
  const byDay = {}; filtered.forEach(r => { const d = toDayStr(new Date(r.created_at)); byDay[d] = byDay[d] || []; byDay[d].push(r) })
  const days = Object.keys(byDay).sort().reverse()

  return <main className="page-wrap"><div className="page-header-row"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Corrections</h1><p className="page-subtitle">Edit or delete Maya Branch entries with a permanent audit trail.</p></div></div>
    {message && <div className={`mb-4 max-w-3xl rounded-xl border p-3 text-sm ${message.type === 'success' ? 'border-green-500/30 bg-green-500/10 text-green-500' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}>{message.text}</div>}
    <div className="mb-4 grid max-w-md grid-cols-3 gap-2 rounded-xl bg-[var(--panel)] p-1">{['sales','expenses','bankings'].map(t => <button key={t} onClick={() => { setTab(t); setEditing(null); setDayFilter('all') }} className={`rounded-lg py-2 text-sm font-bold capitalize ${tab === t ? 'bg-amber-500 text-slate-950' : 'text-muted'}`}>{t}</button>)}</div>
    <div className="mb-6 flex max-w-3xl gap-2 overflow-x-auto pb-2"><button onClick={() => setDayFilter('all')} className={`whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-bold ${dayFilter === 'all' ? 'border-amber-500 bg-amber-500 text-slate-950' : 'border-[var(--line)] text-muted'}`}>All days</button>{allDays.map(d => <button key={d} onClick={() => setDayFilter(d)} className={`whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-bold ${dayFilter === d ? 'border-amber-500 bg-amber-500 text-slate-950' : 'border-[var(--line)] text-muted'}`}>{d}</button>)}</div>
    <div className="mb-10 max-w-3xl space-y-6">{days.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No Maya Branch entries for this selection.</div>}{days.map(day => <div key={day}><h3 className="mb-2 text-sm font-black text-amber-500">{day} · {byDay[day].length} entries</h3><div className="space-y-3">{byDay[day].map(row => <div key={row.id} className="page-card p-4">{editing === row.id ? <div className="space-y-3">{FIELDS[tab].map(k => <div key={k}><label className="mb-1 block text-[10px] uppercase text-muted">{k.replace(/_/g,' ')}</label><input value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="input-base" /></div>)}<input value={reason} onChange={(e) => setReason(e.target.value)} className="input-base" placeholder="Reason for correction" /><div className="flex gap-2"><button onClick={saveEdit} className="rounded-lg bg-green-500 px-4 py-2 text-sm font-black text-slate-950">Save</button><button onClick={() => setEditing(null)} className="btn-secondary rounded-lg px-4 py-2 text-sm font-bold">Cancel</button></div></div> : <div className="flex items-start justify-between gap-3"><div className="text-sm"><p className="font-black">#{row.id} · {new Date(row.created_at).toLocaleString()}</p>{tab === 'sales' && <p className="mt-1 text-muted">{row.item_label || 'item'} × {row.quantity} · {row.customer_name} · {Number(row.total_amount).toLocaleString()}</p>}{tab === 'expenses' && <p className="mt-1 text-muted">{row.description} · {row.category} · {Number(row.amount).toLocaleString()}</p>}{tab === 'bankings' && <p className="mt-1 text-muted">{Number(row.amount_banked).toLocaleString()} · {row.banking_date} · {row.bank_or_method || '—'} · {row.status}</p>}</div><div className="flex flex-col gap-2"><button onClick={() => startEdit(row)} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-black text-slate-950">Edit</button><button onClick={() => deleteRow(row)} className="rounded-lg bg-red-500 px-3 py-2 text-xs font-black text-white">Delete</button></div></div>}</div>)}</div></div>)}</div>
    <h2 className="mb-3 text-lg font-black">Correction Audit Trail</h2><div className="max-w-3xl space-y-2">{audit.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No corrections yet.</div>}{audit.map(a => <div key={a.id} className="page-card p-3 text-xs"><p className="font-black">{a.table_name} #{a.row_id} · {a.field_name}: {a.new_value === 'DELETED' ? `DELETED (${a.old_value})` : `${a.old_value} → ${a.new_value}`}</p><p className="mt-1 text-muted">{userMap[a.changed_by]?.full_name || '—'} · {new Date(a.changed_at).toLocaleString()} · {a.reason}</p></div>)}</div>
  </main>
}
