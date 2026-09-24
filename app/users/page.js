'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const ROLES = ['employee', 'admin', 'super_admin']
const prettyRole = (role) => role === 'super_admin' ? 'Super Admin' : role === 'admin' ? 'Admin' : 'Employee'
const prettyDate = (value) => value ? new Date(value).toLocaleString() : 'Never'

export default function UsersPage() {
  const [profile, setProfile] = useState(null)
  const [users, setUsers] = useState([])
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('employee')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const callApi = async (method, body) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/admin/users', {
      method,
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${session.access_token}` },
      body: body ? JSON.stringify(body) : undefined
    })
    return { ok: res.ok, ...(await res.json()) }
  }

  const load = async () => {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return (window.location.href = '/login')
    const { data: prof } = await supabase.from('users').select('*').eq('id', session.user.id).single()
    setProfile(prof)
    if (prof?.role !== 'super_admin') { setLoading(false); return }
    const result = await callApi('GET')
    if (result.ok) setUsers(result.users || [])
    else setMessage({ type: 'error', text: result.error || 'Could not load users.' })
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const createUser = async (e) => {
    e.preventDefault()
    setBusy(true); setMessage(null)
    const r = await callApi('POST', { email, password, full_name: fullName, role })
    if (r.ok) {
      setMessage({ type: 'success', text: `${fullName} created as ${prettyRole(role)}.` })
      setFullName(''); setEmail(''); setPassword(''); setRole('employee'); await load()
    } else setMessage({ type: 'error', text: r.error })
    setBusy(false)
  }

  const changeRole = async (u, newRole) => {
    const r = await callApi('PATCH', { user_id: u.id, role: newRole })
    if (!r.ok) setMessage({ type: 'error', text: r.error })
    else { setMessage({ type: 'success', text: `${u.full_name} is now ${prettyRole(newRole)}.` }); load() }
  }

  const toggleActive = async (u) => {
    const r = await callApi('PATCH', { user_id: u.id, active: u.active === false })
    if (!r.ok) setMessage({ type: 'error', text: r.error })
    else { setMessage({ type: 'success', text: `${u.full_name} ${u.active === false ? 'reactivated' : 'disabled'}.` }); load() }
  }

  const resetPassword = async (u) => {
    const np = window.prompt(`Set a new password for ${u.full_name} (minimum 6 characters):`)
    if (!np) return
    const r = await callApi('PATCH', { user_id: u.id, password: np })
    setMessage(r.ok ? { type: 'success', text: `Password reset for ${u.full_name}.` } : { type: 'error', text: r.error })
  }

  if (!profile || loading) return <main className="page-wrap text-muted">Loading users...</main>
  if (profile.role !== 'super_admin') return <main className="page-wrap"><div className="page-card max-w-md p-6"><h1 className="font-black">System administrator only</h1><p className="mt-2 text-sm text-muted">User access belongs to the Super Admin.</p></div></main>

  const activeCount = users.filter(u => u.active !== false).length
  const adminCount = users.filter(u => u.role === 'admin').length

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div><p className="page-eyebrow">System administration</p><h1 className="page-title">Users & Access</h1><p className="page-subtitle">Manage accounts, roles and passwords without exposing stored passwords.</p></div>
      </div>

      {message && <div className={`mb-5 max-w-4xl rounded-xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}>{message.text}</div>}

      <section className="mb-6 grid gap-3 sm:grid-cols-3 max-w-4xl">
        <div className="page-card p-4"><p className="text-sm text-muted">Total users</p><p className="mt-2 text-2xl font-black">{users.length}</p></div>
        <div className="page-card p-4"><p className="text-sm text-muted">Active</p><p className="mt-2 text-2xl font-black text-emerald-500">{activeCount}</p></div>
        <div className="page-card p-4"><p className="text-sm text-muted">Business Admins</p><p className="mt-2 text-2xl font-black">{adminCount}</p></div>
      </section>

      <form onSubmit={createUser} className="page-card mb-7 max-w-4xl p-5 sm:p-6">
        <h2 className="page-section-title">Create account</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required className="input-base" placeholder="Full name" />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="input-base" placeholder="Email" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="input-base" placeholder="Temporary password" />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="input-base">{ROLES.map(r => <option key={r} value={r}>{prettyRole(r)}</option>)}</select>
        </div>
        <p className="mt-3 text-xs text-muted">Passwords cannot be viewed later. Super Admin can only reset them.</p>
        <button type="submit" disabled={busy} className="btn-primary mt-4 rounded-xl px-4 py-3 text-sm font-black disabled:opacity-50">{busy ? 'Creating...' : 'Create user'}</button>
      </form>

      <section className="max-w-4xl">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-black">Accounts</h2><span className="text-xs text-muted">Maya Branch system users</span></div>
        <div className="space-y-3">
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
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
