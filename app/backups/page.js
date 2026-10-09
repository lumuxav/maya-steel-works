'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { adminApi } from '../../lib/adminApi'

const ACTIONS = 'https://github.com/lumuxav/maya-steel-works/actions/workflows/maya-encrypted-backup.yml'
const formatDate = (date) => date ? new Date(date).toLocaleString() : 'Not available'

export default function MayaBackupsPage() {
  const [profile, setProfile] = useState(null)
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return window.location.replace('/login')
    const { data: person, error } = await supabase.from('users')
      .select('role,active,branch').eq('id',session.user.id).single()
    if (error) {
      setState({ ok: false, error: 'Could not verify Maya account permissions.' })
      setLoading(false)
      return
    }
    setProfile(person)
    if (person?.role !== 'super_admin' || person?.active !== true || person?.branch !== 'Maya Branch') {
      setLoading(false)
      return
    }
    setState(await adminApi('/api/admin/backups'))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  if (loading) return <main className="page-wrap text-muted">Checking Maya backup status...</main>
  if (!profile || profile.role !== 'super_admin' || profile.active !== true || profile.branch !== 'Maya Branch') {
    return <main className="page-wrap"><section className="page-card max-w-xl p-6"><h1 className="page-title">System Super Admin only</h1><p className="mt-3 text-sm text-muted">Only Maya's active System Super Admin can view backup administration.</p></section></main>
  }

  const latest = state?.latest
  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Maya Branch · System administration</p>
          <h1 className="page-title">Backup & Recovery</h1>
          <p className="page-subtitle">Encrypted database exports, off-site retention and recovery verification.</p>
        </div>
        <button type="button" onClick={load} className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Refresh</button>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="page-card p-5">
          <p className="text-sm text-muted">Latest encrypted backup</p>
          <p className="mt-2 font-black">{latest ? formatDate(latest.completedAt) : 'Not independently verified'}</p>
          <p className="mt-2 text-xs text-muted">GitHub status requires a read-only private-repo token. No status is invented when it is unavailable.</p>
        </div>
        <div className="page-card p-5">
          <p className="text-sm text-muted">Encrypted artifact</p>
          <p className="mt-2 font-black">{latest?.archiveAvailable ? 'Available on GitHub' : 'Not verified / unavailable'}</p>
          <p className="mt-2 text-xs text-muted">{latest?.artifactExpiresAt ? `Expires: ${formatDate(latest.artifactExpiresAt)}` : 'GitHub copies expire after three days. Download and store separately.'}</p>
        </div>
        <div className="page-card p-5">
          <p className="text-sm text-muted">Restore tested</p>
          <p className="mt-2 font-black text-amber-500">Not yet certified</p>
          <p className="mt-2 text-xs text-muted">An archive-index check is not the same as restoring Auth, roles and data to an isolated Supabase project.</p>
        </div>
      </section>

      {state?.error && <div className="page-card mt-4 p-4 text-sm text-red-500">{state.error}</div>}
      {state?.note && <div className="page-card mt-4 p-4 text-sm text-muted">{state.note}</div>}

      <section className="page-card mt-6 max-w-4xl p-6">
        <h2 className="text-lg font-black">Download an encrypted backup</h2>
        <p className="mt-2 text-sm text-muted">In GitHub Actions, open Maya Encrypted Database Backup, select Run workflow on main, and wait for success. Open the successful run and download the encrypted artifact. It is never committed to the repository.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href={latest?.url || ACTIONS} target="_blank" rel="noopener noreferrer" className="btn-primary rounded-xl px-4 py-3 text-sm font-black">Open GitHub backups ↗</a>
          <Link href="/system-control" className="btn-secondary rounded-xl px-4 py-3 text-sm font-bold">System Control</Link>
        </div>
      </section>

      <section className="mt-6 grid max-w-4xl gap-4 sm:grid-cols-2">
        <div className="page-card p-5">
          <h2 className="font-black">Initial setup · Super Admin</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
            <li>Generate and privately store an age keypair on your own computer.</li>
            <li>Set the Maya-only PostgreSQL connection URL as a GitHub Actions secret.</li>
            <li>Set the public age recipient as a GitHub repository variable.</li>
            <li>Run one manual backup before enabling the daily schedule.</li>
          </ol>
          <p className="mt-3 text-xs text-muted">The backup workflow is fail-closed until configured; no credentials or private keys are stored in application code.</p>
        </div>
        <div className="page-card p-5">
          <h2 className="font-black">Long-term safekeeping</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
            <li>Download the encrypted .age file before GitHub's three-day artifact expiry.</li>
            <li>Keep dated copies on an encrypted external disk and a second separate safe location.</li>
            <li>Preserve the age private key offline; without it the archive cannot be decrypted.</li>
            <li>Verify the SHA-256 manifest and rehearse restoration in a test environment.</li>
          </ol>
          <p className="mt-3 text-xs text-muted">Supabase Storage image/file bytes need a separate export. Never upload an unencrypted archive or private key to GitHub.</p>
        </div>
      </section>

      <p className="mt-6 text-xs text-muted">Full setup and restore guide: <a className="text-accent font-bold underline" href="https://github.com/lumuxav/maya-steel-works/blob/main/docs/BACKUP_AND_RECOVERY.md" target="_blank" rel="noopener noreferrer">Maya Backup & Recovery documentation ↗</a></p>
    </main>
  )
}
