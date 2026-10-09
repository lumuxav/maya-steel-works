'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SYSTEM_BRANCH, getSystemUserIds } from '../../lib/branch'

const FIELDS = {
  sales: ['customer_name', 'item_label'],
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
  const [saving, setSaving] = useState(false)
  const requestRef = useRef(null)

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
  const editableFields = (row) => tab === 'bankings' && row?.status === 'confirmed' ? ['bank_or_method'] : FIELDS[tab]
  const startEdit = (row) => { setEditing(row.id); const fields = {}; editableFields(row).forEach(k => { fields[k] = row[k] ?? '' }); setForm(fields); setReason(''); requestRef.current = null }

  const saveEdit = async () => {
    if (saving) return
    const row = rows.find(r => r.id === editing)
    if (!row) return setMessage({ type: 'error', text: 'Record not found. Refresh the page.' })
    const changes = {}
    editableFields(row).forEach(k => {
      if (String(norm(k, row[k])) !== String(norm(k, form[k]))) changes[k] = norm(k, form[k])
    })
    if (!Object.keys(changes).length) return setMessage({ type: 'error', text: 'Nothing changed.' })
    if (reason.trim().length < 6) return setMessage({ type: 'error', text: 'Please enter a reason of at least 6 characters.' })
    const details = { table: tab, id: editing, changes, reason: reason.trim() }
    const signature = JSON.stringify(details)
    if (!requestRef.current || requestRef.current.signature !== signature) {
      requestRef.current = { id: crypto.randomUUID(), signature }
    }
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('maya_correct_record', {
        p_table: tab, p_row_id: editing, p_changes: changes,
        p_reason: reason.trim(), p_request_id: requestRef.current.id,
      })
      if (error) throw error
      requestRef.current = null
      setMessage({ type: 'success', text: `Saved ${data.changes} audited change(s). No financial record was deleted.` })
      setEditing(null)
      await load()
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Correction failed and was not saved.' })
    } finally {
      setSaving(false)
    }
  }

  if (!profile || loading) return <main className="page-wrap text-muted">Loading corrections...</main>
  if (profile.role !== 'admin' && profile.role !== 'super_admin') return <main className="page-wrap"><div className="page-card max-w-md p-6"><p className="font-black">Management only</p></div></main>

  const allDays = Array.from(new Set(rows.map(r => toDayStr(new Date(r.created_at))))).sort().reverse()
  const filtered = dayFilter === 'all' ? rows : rows.filter(r => toDayStr(new Date(r.created_at)) === dayFilter)
  const byDay = {}; filtered.forEach(r => { const d = toDayStr(new Date(r.created_at)); byDay[d] = byDay[d] || []; byDay[d].push(r) })
  const days = Object.keys(byDay).sort().reverse()

  return <main className="page-wrap"><div className="page-header-row"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Corrections</h1><p className="page-subtitle">Audited management corrections. Financial records cannot be deleted; quantities and payments require dedicated business adjustments.</p></div></div>
    {message && <div className={`mb-4 max-w-3xl rounded-xl border p-3 text-sm ${message.type === 'success' ? 'border-green-500/30 bg-green-500/10 text-green-500' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}>{message.text}</div>}
    <div className="mb-4 grid max-w-md grid-cols-3 gap-2 rounded-xl bg-[var(--panel)] p-1">{['sales','expenses','bankings'].map(t => <button key={t} onClick={() => { setTab(t); setEditing(null); setDayFilter('all') }} className={`rounded-lg py-2 text-sm font-bold capitalize ${tab === t ? 'bg-amber-500 text-slate-950' : 'text-muted'}`}>{t}</button>)}</div>
    <div className="mb-6 flex max-w-3xl gap-2 overflow-x-auto pb-2"><button onClick={() => setDayFilter('all')} className={`whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-bold ${dayFilter === 'all' ? 'border-amber-500 bg-amber-500 text-slate-950' : 'border-[var(--line)] text-muted'}`}>All days</button>{allDays.map(d => <button key={d} onClick={() => setDayFilter(d)} className={`whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-bold ${dayFilter === d ? 'border-amber-500 bg-amber-500 text-slate-950' : 'border-[var(--line)] text-muted'}`}>{d}</button>)}</div>
    <div className="mb-10 max-w-3xl space-y-6">{days.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No Maya Branch entries for this selection.</div>}{days.map(day => <div key={day}><h3 className="mb-2 text-sm font-black text-amber-500">{day} · {byDay[day].length} entries</h3><div className="space-y-3">{byDay[day].map(row => <div key={row.id} className="page-card p-4">{editing === row.id ? <div className="space-y-3">{editableFields(row).map(k => <div key={k}><label className="mb-1 block text-[10px] uppercase text-muted">{k.replace(/_/g,' ')}</label><input value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="input-base" /></div>)}<input value={reason} onChange={(e) => setReason(e.target.value)} className="input-base" placeholder="Reason for correction" /><div className="flex gap-2"><button disabled={saving} onClick={saveEdit} className="rounded-lg bg-green-500 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50">{saving ? 'Saving...' : 'Save with audit'}</button><button disabled={saving} onClick={() => { setEditing(null); requestRef.current = null }} className="btn-secondary rounded-lg px-4 py-2 text-sm font-bold">Cancel</button></div></div> : <div className="flex items-start justify-between gap-3"><div className="text-sm"><p className="font-black">#{row.id} · {new Date(row.created_at).toLocaleString()}</p>{tab === 'sales' && <p className="mt-1 text-muted">{row.item_label || 'item'} × {row.quantity} · {row.customer_name} · {Number(row.total_amount).toLocaleString()}</p>}{tab === 'expenses' && <p className="mt-1 text-muted">{row.description} · {row.category} · {Number(row.amount).toLocaleString()}</p>}{tab === 'bankings' && <p className="mt-1 text-muted">{Number(row.amount_banked).toLocaleString()} · {row.banking_date} · {row.bank_or_method || '—'} · {row.status}</p>}</div><div className="flex flex-col gap-2"><button onClick={() => startEdit(row)} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-black text-slate-950">Edit</button></div></div>}</div>)}</div></div>)}</div>
    <h2 className="mb-3 text-lg font-black">Correction Audit Trail</h2><div className="max-w-3xl space-y-2">{audit.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No corrections yet.</div>}{audit.map(a => <div key={a.id} className="page-card p-3 text-xs"><p className="font-black">{a.table_name} #{a.row_id} · {a.field_name}: {a.new_value === 'DELETED' ? `DELETED (${a.old_value})` : `${a.old_value} → ${a.new_value}`}</p><p className="mt-1 text-muted">{userMap[a.changed_by]?.full_name || '—'} · {new Date(a.changed_at).toLocaleString()} · {a.reason}</p></div>)}</div>
  </main>
}
