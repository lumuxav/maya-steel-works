'use client'

import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { buildCustomJobPayload, jobTotals, MAX_JOB_MATERIALS } from '../../lib/customJob.mjs'

// Custom job: the customer picks stock and we cut / press / make it there and then.
// The metal comes off Maya Branch stock (a half or a quarter of a sheet is fine) and is charged,
// and the labour is charged as its own line. Everything is saved in one step by the database
// (maya_ledger 'custom_job'): if anything is wrong, nothing is saved and no stock moves.

const FRACTIONS = [['¼', '0.25'], ['½', '0.5'], ['¾', '0.75'], ['1', '1']]
const IDEAS = ['Ribbed plate', 'Louvers', 'Kibaati / strips', 'Cut to size', 'Bending / folding', 'Plasma CNC cut']

let lineCounter = 0
const newLine = () => ({ key: ++lineCounter, raw_id: '', raw_units: '', unit_price: '' })

const rawLabel = (r) => [r.category, r.gauge, r.size_dimensions].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
const money = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
const qtyText = (n) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: 3 })

export default function CustomJobForm({ raws, onMessage, onRecorded }) {
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState(() => [newLine()])
  const [labour, setLabour] = useState('')
  const [customer, setCustomer] = useState('')
  const [status, setStatus] = useState('paid')
  const [paidAmount, setPaidAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const requestRef = useRef(null)

  const rawById = new Map(raws.map((r) => [r.id, r]))
  const totals = jobTotals(lines, labour)
  const paidNow = status === 'paid' ? totals.total : status === 'credit' ? 0 : Number(paidAmount) || 0

  const setLine = (key, patch) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () => setLines((all) => (all.length >= MAX_JOB_MATERIALS ? all : [...all, newLine()]))
  const removeLine = (key) => setLines((all) => (all.length <= 1 ? all : all.filter((l) => l.key !== key)))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    onMessage(null)
    let built
    try {
      built = buildCustomJobPayload({
        description, customer, status, paidAmount, labour, materials: lines,
        available: Object.fromEntries(raws.map((r) => [r.id, Number(r.quantity)])),
        units: Object.fromEntries(raws.map((r) => [r.id, r.unit])),
      })
    } catch (err) {
      onMessage({ type: 'error', text: err.message })
      setSaving(false)
      return
    }
    // The same request keeps the same key, so pressing the button twice (or a retry after a bad
    // connection) can never take the stock twice.
    const signature = JSON.stringify(built.payload)
    if (!requestRef.current || requestRef.current.signature !== signature) requestRef.current = { id: crypto.randomUUID(), signature }
    const { data: result, error } = await supabase.rpc('maya_ledger', {
      p_operation: 'custom_job', p_data: built.payload, p_request_id: requestRef.current.id,
    })
    if (error) {
      onMessage({ type: 'error', text: error.message })
      setSaving(false)
      return
    }
    requestRef.current = null

    const used = built.payload.materials
      .map((m) => `${qtyText(m.raw_units)} × ${rawLabel(rawById.get(m.raw_id) || {}) || 'stock item'}`)
      .join(', ')
    const total = Number(result?.total ?? built.totals.total)
    const paid = Number(result?.amount_paid ?? paidNow)
    const labourPart = Number(result?.labour ?? built.totals.labour)
    const metalPart = Number(result?.material_total ?? built.totals.material)
    const settled = paid >= total ? 'Paid in full.' : `Paid ${money(paid)}, still owed ${money(total - paid)}.`
    onMessage({
      type: 'success',
      text: `Custom job #${result?.job_id} recorded for ${result?.customer_name || 'Walk-in'}: metal ${money(metalPart)}${labourPart > 0 ? ` + labour ${money(labourPart)}` : ''} = ${money(total)} UGX. ${settled} Stock used: ${used}.`,
      links: [{ href: '/inventory/ledger', label: 'See the stock trail →' }],
    })
    setDescription(''); setLines([newLine()]); setLabour(''); setCustomer(''); setStatus('paid'); setPaidAmount('')
    onRecorded()
    setSaving(false)
  }

  return (
    <form onSubmit={submit} className="space-y-5" aria-label="Custom job">
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-muted">
        <strong className="text-amber-500">Customer asked for something made from our stock.</strong> Take the stock from the store, say how much of it was used, and charge the metal and the labour separately. The stock is deducted and both charges are recorded together.
      </div>

      <div>
        <label htmlFor="job-description" className="mb-2 block text-sm font-bold">What is being made? *</label>
        <input id="job-description" list="job-ideas" value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={200} className="input-base" placeholder="e.g. Ribbed plate, half sheet" />
        <datalist id="job-ideas">{IDEAS.map((i) => <option key={i} value={i} />)}</datalist>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-bold">Stock used *</p>
        {lines.map((line, index) => {
          const item = rawById.get(Number(line.raw_id))
          const lineTotal = totals.lines[index]
          return (
            <fieldset key={line.key} className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3">
              <legend className="px-1 text-[11px] font-black uppercase tracking-wide text-muted">Stock item {index + 1}</legend>
              <div>
                <label htmlFor={`job-item-${line.key}`} className="sr-only">Stock item {index + 1}</label>
                <select id={`job-item-${line.key}`} value={line.raw_id} onChange={(e) => setLine(line.key, { raw_id: e.target.value })} required className="input-base">
                  <option value="">Choose stock</option>
                  {raws.map((r) => <option key={r.id} value={r.id}>{rawLabel(r)} — {qtyText(r.quantity)} {r.unit}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`job-qty-${line.key}`} className="mb-1.5 block text-xs font-bold text-muted">Amount used{item?.unit ? ` (${item.unit})` : ''}</label>
                  <input id={`job-qty-${line.key}`} type="number" inputMode="decimal" step="0.001" min="0" value={line.raw_units} onChange={(e) => setLine(line.key, { raw_units: e.target.value })} required className="input-base" placeholder="e.g. 0.5" />
                </div>
                <div>
                  <label htmlFor={`job-price-${line.key}`} className="mb-1.5 block text-xs font-bold text-muted">Price of 1 whole (UGX)</label>
                  <input id={`job-price-${line.key}`} type="number" inputMode="decimal" step="0.01" min="0" value={line.unit_price} onChange={(e) => setLine(line.key, { unit_price: e.target.value })} required className="input-base" placeholder="e.g. 100000" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick amounts">
                <span className="text-xs text-muted">Quick:</span>
                {FRACTIONS.map(([label, value]) => (
                  <button key={value} type="button" onClick={() => setLine(line.key, { raw_units: value })} className={`rounded-full border px-3 py-1 text-xs font-bold ${Number(line.raw_units) === Number(value) && line.raw_units !== '' ? 'border-amber-500 bg-amber-500 text-slate-950' : 'border-[var(--line)] text-muted'}`}>{label}</button>
                ))}
                {lines.length > 1 && <button type="button" onClick={() => removeLine(line.key)} className="ml-auto text-xs font-bold text-red-500 underline">Remove</button>}
              </div>
              {lineTotal > 0 && <p className="text-xs text-muted">Metal for this item: {qtyText(line.raw_units)} × {money(line.unit_price)} = <strong className="text-amber-500">{money(lineTotal)} UGX</strong></p>}
            </fieldset>
          )
        })}
        {lines.length < MAX_JOB_MATERIALS && <button type="button" onClick={addLine} className="btn-secondary w-full rounded-xl py-2.5 text-sm font-bold">+ Add another stock item</button>}
      </div>

      <div>
        <label htmlFor="job-labour" className="mb-2 block text-sm font-bold">Labour charge (UGX)</label>
        <input id="job-labour" type="number" inputMode="decimal" step="0.01" min="0" value={labour} onChange={(e) => setLabour(e.target.value)} className="input-base" placeholder="Blank = no labour charge" />
      </div>

      <div>
        <label htmlFor="job-customer" className="mb-2 block text-sm font-bold">Customer name</label>
        <input id="job-customer" value={customer} onChange={(e) => setCustomer(e.target.value)} className="input-base" placeholder="Blank = walk-in" />
        <p className="mt-1.5 text-xs text-muted">A name is needed for part payment or credit.</p>
      </div>

      <div>
        <p className="mb-2 text-sm font-bold">Payment status *</p>
        <div className="grid grid-cols-3 gap-2">
          {['paid', 'partial', 'credit'].map((x) => <button key={x} type="button" onClick={() => setStatus(x)} className={`rounded-xl border py-3 text-sm font-bold capitalize ${status === x ? 'border-amber-500 bg-amber-500 text-slate-950' : 'btn-secondary'}`}>{x}</button>)}
        </div>
      </div>
      {status === 'partial' && <input type="number" inputMode="decimal" step="0.01" min="0" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} required className="input-base" placeholder="Amount paid now" aria-label="Amount paid now" />}

      {totals.total > 0 && (
        <div className="space-y-1.5 rounded-xl bg-[var(--panel-2)] p-4 text-sm">
          <div className="flex justify-between gap-3"><span className="text-muted">Metal</span><strong>{money(totals.material)} UGX</strong></div>
          <div className="flex justify-between gap-3"><span className="text-muted">Labour</span><strong>{money(totals.labour)} UGX</strong></div>
          <div className="flex justify-between gap-3 border-t border-[var(--line)] pt-2"><span className="font-bold">Total</span><strong className="text-amber-500">{money(totals.total)} UGX</strong></div>
          {status !== 'paid' && <p className="pt-1 text-xs text-muted">Paid now: {money(paidNow)} UGX · Owed: {money(Math.max(0, totals.total - paidNow))} UGX</p>}
        </div>
      )}

      <button type="submit" disabled={saving} className="w-full rounded-xl bg-amber-500 py-3.5 font-black text-slate-950 disabled:opacity-50">{saving ? 'Saving...' : 'Record Job & Deduct Stock'}</button>
    </form>
  )
}
