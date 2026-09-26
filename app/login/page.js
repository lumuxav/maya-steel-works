'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { setCachedProfile, clearSessionProfileCache } from '../../lib/sessionCache'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    let mounted = true

    const restore = async () => {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (!mounted) return
      if (sessionError || !session) {
        setCheckingSession(false)
        return
      }

      const { data: prof, error: profileError } = await supabase
        .from('users')
        .select('full_name, role, branch, active')
        .eq('id', session.user.id)
        .maybeSingle()

      if (!mounted) return
      if (profileError) {
        setCheckingSession(false)
        return
      }

      if (!prof || prof.active === false) {
        clearSessionProfileCache()
        await supabase.auth.signOut()
        setCheckingSession(false)
        return
      }

      setCachedProfile(session.user.id, prof)
      router.replace('/')
    }

    restore()
    return () => { mounted = false }
  }, [router])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) {
      setError('Wrong email or password.')
      setLoading(false)
      return
    }

    const { data: prof } = await supabase.from('users').select('full_name, role, branch, active').eq('id', data.user.id).single()
    if (!prof) {
      setError('No staff profile found for this account — contact management.')
      clearSessionProfileCache()
      await supabase.auth.signOut()
      setLoading(false)
      return
    }
    if (prof.active === false) {
      setError('This account has been deactivated — contact management.')
      clearSessionProfileCache()
      await supabase.auth.signOut()
      setLoading(false)
      return
    }

    setCachedProfile(data.user.id, prof)
    router.replace('/')
  }

  if (checkingSession) {
    return <main className="min-h-screen grid place-items-center px-5 py-8 text-muted" style={{ background: 'var(--bg)' }}>Opening Maya Steel Works...</main>
  }

  return (
    <main className="min-h-screen grid place-items-center px-5 py-8" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-[390px]">
        <div className="mb-7 text-center">
          <div className="app-brand-mark mx-auto mb-4">MS</div>
          <h1 className="text-2xl font-black tracking-tight">Maya Steel Works</h1>
          <p className="mt-1 text-sm text-muted">Management System</p>
        </div>

        <form onSubmit={handleSubmit} className="page-card p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="text-lg font-black">Welcome back</h2>
            <p className="mt-1 text-sm text-muted">Sign in to continue.</p>
          </div>

          {error && <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-500" role="alert">{error}</div>}

          <label htmlFor="email" className="mb-2 block text-sm font-bold">Email address</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="input-base" placeholder="name@example.com" />

          <label htmlFor="password" className="mb-2 mt-4 block text-sm font-bold">Password</label>
          <div className="relative">
            <input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="input-base pr-16" placeholder="Enter password" />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-2 my-auto h-fit rounded-lg px-2 py-1 text-xs font-bold text-muted">{showPassword ? 'Hide' : 'Show'}</button>
          </div>

          <button type="submit" disabled={loading} className="btn-primary mt-5 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{loading ? 'Signing in...' : 'Sign in'}</button>
        </form>

        <p className="mt-4 text-center text-xs text-muted">Appearance can be changed in Settings after sign in.</p>
      </div>
    </main>
  )
}
