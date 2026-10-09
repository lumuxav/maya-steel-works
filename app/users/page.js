'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { adminApi } from '../../lib/adminApi'

const ROLES = ['employee', 'admin', 'super_admin']
const prettyRole = (role) => role === 'super_admin' ? 'Super Admin' : role === 'admin' ? 'Admin' : 'Employee'
const prettyDate = (value) => value ? new Date(value).toLocaleString() : 'Never'

export default function UsersPage() {
  const [profile, setProfile] = useState(null)
  const [users, setUsers] = useState([])
  const [archivedUsers, setArchivedUsers] = useState([])
  const [restoreCandidate, setRestoreCandidate] = useState(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('employee')
  const [message, setMessage] = useState(null)
  const [rowMessages, setRowMessages] = useState({})
  const [busy, setBusy] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [loading, setLoading] = useState(true)

  const callApi = async (method, body) => adminApi('/api/admin/users', { method, body: body ? JSON.stringify(body) : undefined })

  const load = async () => {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return (window.location.href = '/login')

    const { data: prof } = await supabase.from('users').select('*').eq('id', session.user.id).single()
    setProfile(prof)
    if (prof?.role !== 'super_admin') { setLoading(false); return }

    const result = await callApi('GET')
    if (result.ok) {
      setUsers(result.users || [])
      setArchivedUsers(result.archived_users || [])
      setMessage(null)
    } else {
      setMessage({ type: 'error', text: result.error || 'Could not load users.' })
      if (result.status === 401) {
        await supabase.auth.signOut()
        setTimeout(() => { window.location.href = '/login' }, 800)
      }
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const prepareRestore = (account) => {
    setRestoreCandidate({ id: account.id, full_name: account.full_name })
    setFullName(account.full_name)
    setEmail(account.email || '')
    setRole(ROLES.includes(account.role) ? account.role : 'employee')
    setPassword('')
    setMessage({ type: 'info', text: 'Enter a new temporary password, review the role and confirm restoration. Only restore if this is the same returning employee; their historical transactions remain linked to this account.' })
    document.getElementById('maya-account-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const createUser = async (e) => {
    e.preventDefault()
    if (busy) return

    if (restoreCandidate && !window.confirm(
      `Restore ${restoreCandidate.full_name} using ${email}?\\n\\nOnly proceed if this is the same returning employee. Their prior business history will remain linked to this account. The temporary password and role will be replaced and login will be re-enabled.`
    )) return

    setBusy(true)
    setMessage(null)
    try {
      const r = await callApi('POST', {
        email, password, full_name: fullName, role,
        ...(restoreCandidate ? { restore_archived: true, archived_user_id: restoreCandidate.id } : {}),
      })

      if (r.ok) {
        const wasRestored = r.restored === true
        const accountName = fullName
        setFullName('')
        setEmail('')
        setPassword('')
        setRole('employee')
        setRestoreCandidate(null)
        await load()
        setMessage({
          type: 'success',
          text: wasRestored
            ? `${accountName} restored successfully with a new password and ${prettyRole(role)} access. Prior transaction history is preserved.`
            : `${accountName} created as ${prettyRole(role)}.`,
        })
      } else if (r.code === 'ARCHIVED_ACCOUNT' && r.archived_user_id) {
        setRestoreCandidate({ id: r.archived_user_id, full_name: r.archived_full_name })
        setMessage({
          type: 'info',
          text: `This email belongs to archived employee ${r.archived_full_name}. If the SAME person is returning, confirm Restore account below. Their original history will be preserved. Do not use this option for a different employee.`,
        })
      } else {
        setMessage({ type: 'error', text: r.error || 'Could not save the account.' })
        if (restoreCandidate && r.status === 409) setRestoreCandidate(null)
      }
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Could not save the account.' })
    } finally {
      setBusy(false)
    }
  }

  const changeRole = async (u, newRole) => {
    const r = await callApi('PATCH', { user_id: u.id, role: newRole })
    if (!r.ok) setRowMessages(m => ({ ...m, [u.id]: { type: 'error', text: r.error || 'Could not change role.' } }))
    else {
      setRowMessages(m => ({ ...m, [u.id]: { type: 'success', text: `${u.full_name} is now ${prettyRole(newRole)}.` } }))
      load()
    }
  }

  const toggleActive = async (u) => {
    const r = await callApi('PATCH', { user_id: u.id, active: u.active === false })
    if (!r.ok) setRowMessages(m => ({ ...m, [u.id]: { type: 'error', text: r.error || 'Could not update access.' } }))
    else {
      setRowMessages(m => ({ ...m, [u.id]: { type: 'success', text: `${u.full_name} ${u.active === false ? 'reactivated' : 'disabled'}.` } }))
      load()
    }
  }

  const resetPassword = async (u) => {
    const np = window.prompt(`Set a new password for ${u.full_name} (minimum 6 characters):`)
    if (!np) return
    const r = await callApi('PATCH', { user_id: u.id, password: np })
    setRowMessages(m => ({
      ...m,
      [u.id]: r.ok ? { type: 'success', text: `Password reset for ${u.full_name}.` } : { type: 'error', text: r.error || 'Could not reset password.' }
    }))
  }

  const deleteUser = async (u) => {
    if (u.id === profile.id) return
    const first = window.confirm(`Remove ${u.full_name} from Maya access?\n\nThis disables the login and archives the account. Historical activity is preserved. If the SAME employee returns, a Super Admin can restore this account with a new password.`)
    if (!first) return
    const confirmText = window.prompt(`Type ARCHIVE to remove ${u.full_name} from active access:`)
    if (confirmText !== 'ARCHIVE') return

    setDeletingId(u.id)
    setRowMessages(m => ({ ...m, [u.id]: null }))
    const r = await callApi('DELETE', { user_id: u.id })
    if (r.ok) {
      setUsers(current => current.filter(x => x.id !== u.id))
      await load()
      setMessage({ type: 'success', text: `${u.full_name} was archived and cannot sign in. Their email remains reserved for a future restoration, and previous business history was preserved.` })
    } else {
      setRowMessages(m => ({ ...m, [u.id]: { type: 'error', text: r.error || 'Could not delete user.' } }))
    }
    setDeletingId(null)
  }

  if (!profile || loading) return <main className="page-wrap text-muted">Loading users...</main>
  if (profile.role !== 'super_admin') return <main className="page-wrap"><div className="page-card max-w-md p-6"><h1 className="font-black">System administrator only</h1><p className="mt-2 text-sm text-muted">User access belongs to the Super Admin.</p></div></main>

  const activeCount = users.filter(u => u.active !== false).length
  const adminCount = users.filter(u => u.role === 'admin').length

  return (
    <main className="page-wrap">
      <div className="page-header-row"><div><p className="page-eyebrow">System administration</p><h1 className="page-title">Users & Access</h1><p className="page-subtitle">Manage accounts, roles and passwords without exposing stored passwords.</p></div></div>

      {message && <div className={`mb-5 max-w-4xl rounded-xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : message.type === 'info' ? 'border-blue-500/30 bg-blue-500/10 text-accent' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}>{message.text}</div>}

      <section className="mb-6 grid gap-3 sm:grid-cols-3 max-w-4xl">
        <div className="page-card p-4"><p className="text-sm text-muted">Total users</p><p className="mt-2 text-2xl font-black">{users.length}</p></div>
        <div className="page-card p-4"><p className="text-sm text-muted">Active</p><p className="mt-2 text-2xl font-black text-emerald-500">{activeCount}</p></div>
        <div className="page-card p-4"><p className="text-sm text-muted">Business Admins</p><p className="mt-2 text-2xl font-black">{adminCount}</p></div>
      </section>

      <form id="maya-account-form" onSubmit={createUser} className="page-card mb-7 max-w-4xl p-5 sm:p-6">
        <h2 className="page-section-title">{restoreCandidate ? 'Restore archived employee' : 'Create account'}</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required className="input-base" placeholder="Full name" />
          <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setRestoreCandidate(null) }} required className="input-base" placeholder="Email" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="input-base" placeholder="Temporary password" />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="input-base">{ROLES.map(r => <option key={r} value={r}>{prettyRole(r)}</option>)}</select>
        </div>
        <p className="mt-3 text-xs text-muted">{restoreCandidate ? `Restoring ${restoreCandidate.full_name}: assign a NEW temporary password and review their role. Their previous Maya history remains linked.` : 'Passwords cannot be viewed later. Super Admin can only reset them.'}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className="btn-primary rounded-xl px-4 py-3 text-sm font-black disabled:opacity-50">{busy ? 'Saving...' : restoreCandidate ? 'Restore existing account' : 'Create user'}</button>
          {restoreCandidate && <button type="button" disabled={busy} className="btn-secondary rounded-xl px-4 py-3 text-sm font-bold" onClick={() => { setRestoreCandidate(null); setPassword(''); setMessage(null) }}>Cancel restoration</button>}
        </div>
      </form>

      <section className="max-w-4xl">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-black">Accounts</h2><span className="text-xs text-muted">Maya Branch system users</span></div>
        <div className="space-y-3">
          {users.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No user records loaded.</div>}
          {users.map(u => (
            <article key={u.id} className={`page-card p-4 sm:p-5 ${u.active === false ? 'opacity-70' : ''}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{u.full_name}</h3>{u.id === profile.id && <span className="rounded-full bg-[var(--accent-2)] px-2 py-1 text-[10px] font-black text-accent">YOU</span>}<span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${u.active === false ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>{u.active === false ? 'disabled' : 'active'}</span></div>
                  <p className="mt-1 text-sm text-muted">{u.email || 'No email available'}</p>
                  <div className="mt-3 grid gap-1 text-xs text-muted sm:grid-cols-2"><p>Created: {prettyDate(u.auth_created_at || u.created_at)}</p><p>Last sign in: {prettyDate(u.last_sign_in_at)}</p></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select value={u.role} onChange={(e) => changeRole(u, e.target.value)} disabled={u.id === profile.id} className="input-base !w-auto !py-2 text-xs disabled:opacity-50">{ROLES.map(r => <option key={r} value={r}>{prettyRole(r)}</option>)}</select>
                  <button onClick={() => resetPassword(u)} type="button" className="btn-secondary rounded-xl px-3 py-2 text-xs font-bold">Reset password</button>
                  <button onClick={() => toggleActive(u)} type="button" disabled={u.id === profile.id} className={`rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40 ${u.active === false ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>{u.active === false ? 'Reactivate' : 'Disable'}</button>
                  <button onClick={() => deleteUser(u)} type="button" disabled={u.id === profile.id || deletingId === u.id} className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-bold text-red-500 transition hover:bg-red-500/10 disabled:opacity-30">{deletingId === u.id ? 'Archiving...' : 'Archive'}</button>
                </div>
              </div>
              {rowMessages[u.id] && <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${rowMessages[u.id].type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}>{rowMessages[u.id].text}</div>}
            </article>
          ))}
        </div>
      </section>
      {archivedUsers.length > 0 && (
        <section className="mt-8 max-w-4xl">
          <h2 className="text-lg font-black">Archived accounts ({archivedUsers.length})</h2>
          <p className="mt-1 mb-3 text-sm text-muted">Removed users cannot sign in. Restore only the same returning employee, with a new password and reviewed permissions.</p>
          <div className="space-y-3">
            {archivedUsers.map(u => (
              <article key={u.id} className="page-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h3 className="font-black">{u.full_name}</h3>
                  <p className="mt-1 break-all text-sm text-muted">{u.email}</p>
                  <p className="mt-1 text-xs text-muted">Former role: {prettyRole(u.role)} · Archived: {prettyDate(u.archived_at)}</p>
                </div>
                <button type="button" onClick={() => prepareRestore(u)} className="btn-secondary rounded-xl px-4 py-3 text-sm font-bold">Prepare restoration</button>
              </article>
            ))}
          </div>
        </section>
      )}

    </main>
  )
}
