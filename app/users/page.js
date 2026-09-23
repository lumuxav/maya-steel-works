'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'

const ROLES = ['employee', 'admin', 'super_admin']

export default function UsersPage() {
  const [profile, setProfile] = useState(null)
  const [users, setUsers] = useState([])
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('employee')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      window.location.href = '/login'
      return
    }
    const { data: prof } = await supabase.from('users').select('*').eq('id', session.user.id).single()
    setProfile(prof)
    if (prof?.role !== 'super_admin') return
    const { data: u } = await supabase.from('users').select('*').order('created_at', { ascending: true })
    setUsers(u || [])
  }

  useEffect(() => { load() }, [])

  const callApi = async (method, body) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/admin/users', {
      method,
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body)
    })
    return res.json()
  }

  const createUser = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const r = await callApi('POST', { email, password, full_name: fullName, role })
    if (r.ok) {
      setMessage({ type: 'success', text: `${fullName} created as ${role}. They can log in now.` })
      setFullName(''); setEmail(''); setPassword('')
      load()
    } else setMessage({ type: 'error', text: r.error })
    setBusy(false)
  }

  const changeRole = async (u, newRole) => {
    const { error } = await supabase.from('users').update({ role: newRole }).eq('id', u.id)
    if (error) setMessage({ type: 'error', text: error.message })
    else load()
  }

  const toggleActive = async (u) => {
    const { error } = await supabase.from('users').update({ active: !u.active }).eq('id', u.id)
    if (error) setMessage({ type: 'error', text: error.message })
    else load()
  }

  const resetPassword = async (u) => {
    const np = window.prompt(`New password for ${u.full_name} (min 6 characters):`)
    if (!np) return
    if (np.length < 6) {
      setMessage({ type: 'error', text: 'Password too short (min 6).' })
      return
    }
    const r = await callApi('PATCH', { user_id: u.id, password: np })
    setMessage(r.ok ? { type: 'success', text: `Password reset for ${u.full_name}.` } : { type: 'error', text: r.error })
  }

  if (!profile) return <main className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</main>

  if (profile.role !== 'super_admin') {
    return (
      <main className="min-h-screen bg-slate-900 p-6">
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
        <div className="bg-slate-800 rounded-xl p-6 max-w-md mt-8">
          <p className="text-white font-bold">🔒 Super Admin only</p>
          <p className="text-slate-400 text-sm mt-2">User creation, roles and deactivation belong to the system owner.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-900 p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">👤 Users & Roles</h1>
          <p className="text-slate-400 text-sm">Create staff, set roles, deactivate leavers, reset passwords</p>
        </div>
        <Link href="/" className="text-sm text-slate-300 border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-800">← Back</Link>
      </header>

      {message && (
        <div className={`mb-4 max-w-3xl rounded-lg p-3 text-sm ${message.type === 'success' ? 'bg-green-900/50 text-green-200 border border-green-700' : 'bg-red-900/50 text-red-200 border border-red-700'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={createUser} className="bg-slate-800 rounded-xl p-5 space-y-3 max-w-3xl mb-8 border border-purple-500/30">
        <p className="font-bold text-white text-sm">➕ Create a new user</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required
            className="rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="Full name" />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            className="rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="Email" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
            className="rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm" placeholder="Password (min 6)" />
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2 text-sm">
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button type="submit" disabled={busy}
          className="bg-purple-500 hover:bg-purple-400 disabled:opacity-50 text-white font-bold text-sm px-4 py-2 rounded-lg">
          {busy ? 'Creating...' : 'Create User'}
        </button>
      </form>

      <div className="space-y-3 max-w-3xl">
        {users.map(u => (
          <div key={u.id} className={`rounded-xl border p-4 ${u.active === false ? 'border-red-500/40 bg-red-900/10' : 'border-slate-700 bg-slate-800'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-bold text-white">
                  {u.full_name} {u.id === profile.id && <span className="text-xs text-amber-400">(you)</span>}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">
                  {u.active === false ? '🔴 DEACTIVATED — cannot log in' : '🟢 active'} · joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={u.role} onChange={(e) => changeRole(u, e.target.value)} disabled={u.id === profile.id}
                  className="rounded-lg bg-slate-700 border border-slate-600 text-white px-2 py-1.5 text-xs">
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <button onClick={() => toggleActive(u)} disabled={u.id === profile.id}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg ${u.active === false ? 'bg-green-500 text-slate-900 hover:bg-green-400' : 'bg-red-500 text-white hover:bg-red-400'} disabled:opacity-40`}>
                  {u.active === false ? 'Reactivate' : 'Deactivate'}
                </button>
                <button onClick={() => resetPassword(u)}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-700 text-white hover:bg-slate-600">
                  Reset Password
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}