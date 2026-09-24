'use client'

import Link from 'next/link'

export default function TransfersPage() {
  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-500">Maya Branch</p>
          <h1 className="page-title">Transfers</h1>
          <p className="page-subtitle">This installation manages Maya Branch only.</p>
        </div>
      </div>

      <section className="page-card max-w-2xl p-6">
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
          <p className="font-black text-amber-500">Cross-branch transfers are disabled</p>
          <p className="mt-2 text-sm text-muted">
            This system no longer tracks Mbarara, Branch Store, Site / Project or any other branch. Stock shown here belongs to Maya Branch only, so there is no branch destination to transfer to.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/inventory" className="rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-slate-950">View Maya stock</Link>
          <Link href="/" className="btn-secondary rounded-xl px-4 py-3 text-sm font-bold">Back home</Link>
        </div>
      </section>
    </main>
  )
}
