'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { adminApi } from '../../lib/adminApi'
import { MAYA_LAUNCH_LABEL } from '../../lib/mayaBusiness.mjs'
import { periodPreset, periodReportCsv, validatePeriod } from '../../lib/mayaPeriodReport.mjs'

const PRESETS = [['today', 'Today'], ['7d', 'Last 7 days'], ['month', 'This month'], ['last-month', 'Last month'], ['all', 'Since opening']]
const currency = (value) => value == null ? 'Unavailable' : Number(value).toLocaleString('en-UG', { maximumFractionDigits: 2 })

async function fetchReport(dates) {
  validatePeriod(dates.from, dates.to)
  const result = await adminApi(`/api/reports/period?${new URLSearchParams(dates)}`, { cache: 'no-store' })
  if (!result.ok || !result.report) throw new Error(result.error || 'Could not load this report.')
  return result.report
}

function Metric({ label, value, note, tone = '' }) {
  return <div className="page-card min-w-0 p-4"><p className="text-xs text-muted">{label}</p><p className={`mt-2 break-words text-xl font-black sm:text-2xl ${tone}`}>{currency(value)}</p>{note && <p className="mt-2 text-xs text-muted">{note}</p>}</div>
}

function DetailList({ items }) {
  return <dl className="space-y-3 text-sm">{items.map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4"><dt className="text-muted">{label}</dt><dd className="text-right font-bold">{currency(value)}</dd></div>)}</dl>
}

export default function ProfitPage() {
  const [dates, setDates] = useState({ from: '', to: '' })
  const [preset, setPreset] = useState('month')
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exportError, setExportError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [visibleDays, setVisibleDays] = useState(31)
  const request = useRef(0)

  async function load(nextDates) {
    const id = ++request.current
    setError(''); setReport(null); setLoading(true); setVisibleDays(31)
    try {
      const result = await fetchReport(nextDates)
      if (id !== request.current) return
      setReport(result)
    } catch (issue) { if (id === request.current) setError(issue.message) }
    finally { if (id === request.current) setLoading(false) }
  }

  useEffect(() => {
    const id = ++request.current
    const initial = periodPreset('month')
    fetchReport(initial).then((result) => {
      if (id === request.current) { setDates(initial); setReport(result) }
    }).catch((issue) => {
      if (id === request.current) { setDates(initial); setError(issue.message) }
    }).finally(() => {
      if (id === request.current) setLoading(false)
    })
    return () => { request.current += 1 }
  }, [])

  function choosePreset(key) {
    const next = periodPreset(key)
    setPreset(key); setDates(next); load(next)
  }

  function editDate(key, value) {
    request.current += 1
    setLoading(false); setReport(null); setError(''); setPreset('custom')
    setDates((previous) => ({ ...previous, [key]: value }))
  }

  async function download() {
    if (!report || exporting) return
    setExporting(true); setExportError('')
    try {
      const csv = periodReportCsv(report)
      const filename = `Maya-Period-Report-${report.from}-to-${report.to}.csv`
      if (window.Capacitor?.isNativePlatform?.()) {
        const plugins = window.Capacitor.Plugins
        if (!plugins?.Filesystem?.writeFile || !plugins?.Share?.share) throw new Error('Install the latest Maya APK to export files, or open Maya in your browser.')
        const file = await plugins.Filesystem.writeFile({ path: filename, data: csv, directory: 'CACHE', encoding: 'utf8' })
        await plugins.Share.share({ title: 'Maya Period Report', files: [file.uri], dialogTitle: 'Save or share report' })
      } else {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
        const link = document.createElement('a')
        link.href = url; link.download = filename
        document.body.appendChild(link); link.click(); link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 30000)
      }
    } catch (issue) {
      setExportError(issue.message || 'The report could not be exported. Please try again.')
    } finally { setExporting(false) }
  }

  const t = report?.totals
  return <main className="page-wrap period-report">
    <div className="page-header-row"><div><p className="page-eyebrow">Maya Branch · Management</p><h1 className="page-title">Period Report</h1><p className="page-subtitle">See what Maya sold, received and spent between any two dates.</p></div><Link href="/cashbook" className="btn-secondary rounded-xl px-3 py-2 text-sm font-bold">Cash Book</Link></div>
    <section className="page-card mb-6 p-4 sm:p-5" aria-label="Report date range">
      <div className="mb-4 flex flex-wrap gap-2">{PRESETS.map(([key, label]) => <button key={key} type="button" onClick={() => choosePreset(key)} aria-pressed={preset === key} className={`rounded-xl border px-3 py-2 text-sm font-bold ${preset === key ? 'border-amber-500 bg-amber-500 text-slate-950' : 'border-[var(--line)]'}`}>{label}</button>)}</div>
      <form onSubmit={(event) => { event.preventDefault(); load(dates) }} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="min-w-0 text-sm font-bold" htmlFor="period-from">From<input id="period-from" type="date" required value={dates.from} onChange={(event) => editDate('from', event.target.value)} className="input-base mt-2 block w-full min-w-0" /></label>
        <label className="min-w-0 text-sm font-bold" htmlFor="period-to">To (inclusive)<input id="period-to" type="date" required value={dates.to} onChange={(event) => editDate('to', event.target.value)} className="input-base mt-2 block w-full min-w-0" /></label>
        <button type="submit" disabled={loading} className="rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 disabled:opacity-50">{loading ? 'Calculating…' : 'View report'}</button>
      </form>
      <p className="mt-3 text-xs text-muted">Both dates are included. Uganda time · All amounts in UGX · Operating history begins {MAYA_LAUNCH_LABEL}.</p>
    </section>
    {error && <div role="alert" className="mb-5 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">{error}<button type="button" onClick={() => load(dates)} className="ml-3 font-bold underline">Retry</button></div>}
    {exportError && <p role="alert" className="mb-5 rounded-xl border border-amber-500/40 p-4 text-sm">{exportError}</p>}
    {loading && <p role="status" className="page-card p-6 text-muted">Loading the complete financial history…</p>}
    {!report && !loading && !error && <p className="page-card p-6 text-muted">Choose your dates and select View report.</p>}
    {report && <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-black">{report.from} to {report.to}</h2><p className="mt-1 text-xs text-muted">{report.saleCount.toLocaleString()} sales · {report.operatingDays.toLocaleString()} operating days · Updated {new Date(report.generatedAt).toLocaleString('en-GB', { timeZone: 'Africa/Kampala' })} (Uganda)</p></div><button onClick={download} type="button" disabled={exporting} className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">{exporting ? 'Exporting…' : 'Export CSV'}</button></div>
      {report.notes.length > 0 && <div className="mb-5 space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">{report.notes.map((note) => <p key={note}>{note}</p>)}</div>}
      {report.saleCount === 0 && t.cashReceived === 0 && t.expenses === 0 && t.banked === 0 && t.pendingBanking === 0 && <p className="mb-5 text-sm text-muted">No recorded activity in this period.</p>}
      <section aria-label="Period totals" className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Net sales" value={t.netSales} note="Gross sales less dated credit adjustments" tone="text-green-500" />
        <Metric label="Cash received" value={t.cashReceived} note="Cash at sale + debt payments + advances" tone="text-green-500" />
        <Metric label="Expenses" value={t.expenses} note="Recorded operating expenses" tone="text-red-500" />
        <Metric label="Net cash before banking" value={t.netCashFlow} note="Cash received minus expenses" tone="text-amber-500" />
      </section>
      <div className="mb-8 grid gap-5 lg:grid-cols-2">
        <section className="page-card p-5"><h2 className="mb-4 text-lg font-black">Sales & collections</h2><DetailList items={[
          ['Stock sales', t.stockSales], ['Customer material services', t.serviceSales], ['Gross sales', t.grossSales], ['Credit adjustments in period', t.adjustments],
          ['Cash paid at sale', t.initialCash], ['Debt repayments received', t.repayments], ['Account advances received', t.advances], ['Still owed on these sales at period end', t.outstanding],
        ]} /><p className="mt-4 text-xs text-muted">Repayments can relate to earlier sales. They increase cash only. Advances are not sales. Outstanding credit covers invoices created within the selected operating period.</p></section>
        <section className="page-card p-5"><h2 className="mb-4 text-lg font-black">Cash reconciliation</h2><DetailList items={[
          ['Opening cash carried forward', t.openingCash], ['+ Cash received', t.cashReceived], ['− Expenses', t.expenses], ['− Confirmed banking', t.banked], ['Closing cash in hand', t.closingCash], ['Pending banking (not deducted)', t.pendingBanking],
        ]} /><p className="mt-4 text-xs text-muted">Banking moves cash into the bank; it does not reduce profit. Confirmation status reflects the current record. Negative cash balances indicate a reconciliation issue.</p></section>
      </div>
      <section className="mb-8" aria-label="Estimated profit"><h2 className="mb-3 text-lg font-black">Estimated profit</h2><div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Metric label="Estimated cost of goods" value={t.estimatedCostOfGoods} /><Metric label="Estimated gross profit" value={t.estimatedGrossProfit} /><Metric label="Estimated net profit" value={t.estimatedNetProfit} tone="text-amber-500" /></div><p className="mt-3 text-xs text-muted">Uses current recorded material and production costs; the system does not freeze costs at sale time. Service costs must be recorded in expenses. Returns reduce recorded credit but do not automatically reverse stock cost. These figures are estimates, not finalized accounts.</p></section>
      <section className="mb-8"><h2 className="mb-3 text-lg font-black">Day-by-day breakdown</h2><div className="page-card overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable daily report"><table className="w-full min-w-[880px] text-right text-sm"><caption className="sr-only">Daily totals in UGX for the selected period</caption><thead><tr className="border-b border-[var(--line)]">{['Date', 'Opening', 'Net sales', 'Received', 'Expenses', 'Banked', 'Pending', 'Closing'].map((label) => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead><tbody>{report.daily.slice(0, visibleDays).map((d) => <tr key={d.day} className="border-b border-[var(--line)] last:border-0"><th scope="row" className="whitespace-nowrap p-3 text-left"><Link href={`/cashbook?day=${d.day}`} className="underline">{d.day}</Link></th>{['openingCash', 'netSales', 'cashReceived', 'expenses', 'banked', 'pendingBanking', 'closingCash'].map((key) => <td key={key} className="p-3">{currency(d[key])}</td>)}</tr>)}{!report.daily.length && <tr><td colSpan={8} className="p-5 text-center text-muted">No operating days in this range yet.</td></tr>}</tbody></table></div>{report.daily.length > visibleDays && <button type="button" onClick={() => setVisibleDays((value) => value + 31)} className="btn-secondary mt-3 rounded-xl px-4 py-2 text-sm font-bold">Show 31 more days ({visibleDays} of {report.daily.length})</button>}<p className="mt-2 text-xs text-muted">Download CSV includes every day in the period.</p></section>
      <div className="grid gap-5 lg:grid-cols-2"><section className="page-card p-5"><h2 className="mb-4 text-lg font-black">Expenses by category</h2>{!report.expenseCategories.length && <p className="text-sm text-muted">No recorded expenses.</p>}<DetailList items={report.expenseCategories.map((c) => [c.category, c.total])} /></section><section className="page-card p-5"><h2 className="mb-4 text-lg font-black">Top items & services</h2>{!report.topItems.length && <p className="text-sm text-muted">No recorded sales.</p>}<div className="space-y-3 text-sm">{report.topItems.map((item, index) => <div key={index} className="flex justify-between gap-4"><div className="min-w-0"><p className="break-words font-bold">{item.label}</p><p className="text-xs text-muted">Quantity {currency(item.quantity)} · Gross sales</p></div><p className="font-bold">{currency(item.sales)}</p></div>)}</div></section></div>
    </>}
  </main>
}
