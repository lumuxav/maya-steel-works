'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { SYSTEM_BRANCH, getSystemUserIds } from '../../lib/branch'
import { customerServiceSalePayload } from '../../lib/mayaBusiness.mjs'

const SERVICES = [
  'Ribbed / Pressed Plate',
  'Cut Kibaati / Plain Strips',
  'Louvers',
  'Roller Shutter Channels',
  'Sliding Door Channels',
  'Plasma CNC Design',
  'Other Service',
]

export default function CustomerWorkPage() {
  const [profile, setProfile] = useState(null)
  const [service, setService] = useState(SERVICES[0])
  const [details, setDetails] = useState('')
  const [quantity, setQuantity] = useState('')
  const [rate, setRate] = useState('')
  const [customer, setCustomer] = useState('')
  const [status, setStatus] = useState('paid')
  const [paidAmount, setPaidAmount] = useState('')
  const [todayJobs, setTodayJobs] = useState([])
  const [saving, setSaving] = useState(false)
  const requestRef = useRef(null)
  const [message, setMessage] = useState(null)

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'
  const total = Number(quantity || 0) * Number(rate || 0)
  const paidNow = status === 'paid' ? total : status === 'credit' ? 0 : Number(paidAmount || 0)

  const loadToday = async (session, admin) => {
    const systemUsers = await getSystemUserIds(supabase)
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString()
    const { data } = await supabase.from('sales').select('*').eq('item_type', 'service').gte('created_at', start).order('created_at', { ascending: false })
    const branchRows = (data || []).filter(x => systemUsers.has(x.sold_by))
    setTodayJobs(admin ? branchRows : branchRows.filter(x => x.sold_by === session.user.id))
  }

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return (window.location.href = '/login')
      const { data: prof } = await supabase.from('users').select('full_name, role, branch').eq('id', session.user.id).single()
      setProfile(prof)
      loadToday(session, prof?.role === 'admin' || prof?.role === 'super_admin')
    }
    load()
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setMessage(null)
    const qty = Number(quantity), price = Number(rate)
    if (!Number.isInteger(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) { setMessage({ type: 'error', text: 'Enter the number of plates/pieces worked on and the charge per plate/piece.' }); setSaving(false); return }
    if (status === 'partial' && (paidNow <= 0 || paidNow >= total)) { setMessage({ type: 'error', text: 'Partial payment must be greater than 0 and less than the total charge.' }); setSaving(false); return }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return (window.location.href = '/login')
    const serviceRow = customerServiceSalePayload({
      service, details, quantity: qty, rate: price, status, paidAmount: paidNow,
      customer, soldBy: session.user.id,
    })
    if (!requestRef.current) requestRef.current = crypto.randomUUID()
    const { error } = await supabase.rpc('maya_ledger', {
      p_operation: 'sale',
      p_data: {
        item_type: 'service', quantity: serviceRow.quantity, unit_price: serviceRow.unit_price,
        payment_status: serviceRow.payment_status, amount_paid: serviceRow.amount_paid,
        customer_name: serviceRow.customer_name, item_label: serviceRow.item_label,
      },
      p_request_id: requestRef.current,
    })
    if (error) { setMessage({ type: 'error', text: error.message }); setSaving(false); return }

    requestRef.current = null
    setMessage({ type: 'success', text: `Recorded ${qty} plate/piece${qty === 1 ? '' : 's'} at ${price.toLocaleString()} UGX each. Maya stock was not deducted.` })
    setQuantity(''); setRate(''); setCustomer(''); setDetails(''); setPaidAmount(''); setStatus('paid')
    loadToday(session, isAdmin); setSaving(false)
  }

  if (!profile) return <main className="page-wrap text-muted">Loading...</main>

  return <main className="page-wrap">
    <div className="page-header-row"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">{SYSTEM_BRANCH}</p><h1 className="page-title">Customer Material</h1><p className="page-subtitle">Record paid work done on customer-owned material at Maya Branch.</p></div><Link href="/sales" className="rounded-xl border border-amber-500/40 px-3 py-2 text-sm font-bold text-amber-500">Stock sales</Link></div>
    {message && <div className={`mb-4 max-w-2xl rounded-xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-green-500/30 bg-green-500/10 text-green-500' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}>{message.text}</div>}
    <form onSubmit={handleSubmit} className="page-card max-w-2xl space-y-5 p-4 sm:p-6"><div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm"><p className="font-black text-amber-500">Customer owns the metal</p><p className="mt-1 text-xs text-muted">Only service revenue is recorded. Maya Branch inventory is left untouched.</p></div>
      <div><label className="mb-2 block text-sm font-bold">Service performed *</label><select value={service} onChange={(e) => setService(e.target.value)} className="input-base">{SERVICES.map(item => <option key={item}>{item}</option>)}</select></div>
      <div><label className="mb-2 block text-sm font-bold">Measurements / job details</label><input value={details} onChange={(e) => setDetails(e.target.value)} className="input-base" placeholder={'e.g. 1.2mm × 8ft, cut into 3" strips'} /></div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4"><div><label className="mb-2 block text-sm font-bold">Plates / pieces worked *</label><input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} required className="input-base" /></div><div><label className="mb-2 block text-sm font-bold">Charge per plate / piece *</label><input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} required className="input-base" /></div></div>
      <div><label className="mb-2 block text-sm font-bold">Customer name</label><input value={customer} onChange={(e) => setCustomer(e.target.value)} className="input-base" placeholder="Blank = walk-in" /></div>
      <div><label className="mb-2 block text-sm font-bold">Payment status *</label><div className="grid grid-cols-3 gap-2">{['paid','partial','credit'].map(item => <button key={item} type="button" onClick={() => setStatus(item)} className={`rounded-xl border px-2 py-3 text-sm font-bold capitalize ${status === item ? 'border-amber-500 bg-amber-500 text-slate-950' : 'btn-secondary'}`}>{item}</button>)}</div></div>
      {status === 'partial' && <div><label className="mb-2 block text-sm font-bold">Amount paid now *</label><input type="number" min="0" step="0.01" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} required className="input-base" /></div>}
      {total > 0 && <div className="rounded-2xl border border-amber-500/20 bg-[var(--panel-2)] p-4"><div className="flex items-center justify-between gap-3"><span className="text-sm text-muted">Service total</span><strong className="text-amber-500">{total.toLocaleString()} UGX</strong></div><p className="mt-1 text-xs text-muted">{Number(quantity || 0).toLocaleString()} × {Number(rate || 0).toLocaleString()} UGX per plate/piece</p>{status !== 'paid' && <p className="mt-2 text-xs text-muted">Paid now: {paidNow.toLocaleString()} UGX · Balance: {(total - paidNow).toLocaleString()} UGX</p>}</div>}
      <button type="submit" disabled={saving} className="w-full rounded-xl bg-amber-500 px-4 py-3.5 font-black text-slate-950 disabled:opacity-50">{saving ? 'Recording...' : 'Record Customer Work'}</button>
    </form>
    <section className="mt-8 max-w-2xl"><h2 className="mb-3 text-lg font-black">Today&apos;s Maya Branch customer-material jobs {isAdmin ? '(all staff)' : '(yours)'}</h2><div className="space-y-3">{todayJobs.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No customer-material jobs recorded yet today.</div>}{todayJobs.map(job => <div key={job.id} className="page-card p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{job.item_label}</p><p className="mt-1 text-xs text-muted">{job.customer_name} · {Number(job.quantity).toLocaleString()} plate/piece{Number(job.quantity) === 1 ? '' : 's'}</p></div><span className={`rounded-lg px-2 py-1 text-[10px] font-black uppercase ${job.payment_status === 'paid' ? 'bg-green-500/10 text-green-500' : job.payment_status === 'partial' ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500'}`}>{job.payment_status}</span></div><div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[var(--panel-2)] p-3 text-xs"><div><span className="text-muted">Rate</span><strong className="mt-1 block">{Number(job.unit_price).toLocaleString()}</strong></div><div><span className="text-muted">Total</span><strong className="mt-1 block text-amber-500">{Number(job.total_amount).toLocaleString()}</strong></div><div><span className="text-muted">Paid</span><strong className="mt-1 block">{Number(job.amount_paid).toLocaleString()}</strong></div></div></div>)}</div></section>
  </main>
}
