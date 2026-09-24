'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import ThemePicker from '../components/ThemePicker'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

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

    const { data: prof } = await supabase.from('users').select('full_name, role, active').eq('id', data.user.id).single()
    if (!prof) {
      setError('No staff profile found for this account — contact management.')
      await supabase.auth.signOut()
      setLoading(false)
      return
    }
    if (prof.active === false) {
      setError('This account has been deactivated — contact management.')
      await supabase.auth.signOut()
      setLoading(false)
      return
    }
    router.replace('/')
  }

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--accent)] text-xs font-black text-white">MS</div>
            <div><p className="font-black leading-tight">Maya Steel Works</p><p className="text-xs text-muted">Management System</p></div>
          </div>
          <ThemePicker />
        </header>

        <div className="grid min-h-[calc(100vh-90px)] items-center gap-10 py-10 lg:grid-cols-[1fr_.9fr]">
          <section className="hidden lg:block">
            <p className="text-sm font-bold text-accent">Operations, simplified.</p>
            <h1 className="mt-3 max-w-xl text-5xl font-black leading-[1.05] tracking-tight">Run the day from one clean workspace.</h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted">Stock, production, sales, credit, banking and management records in one place.</p>

            <div className="mt-8 grid max-w-xl grid-cols-2 gap-4">
              <div className="soft-card p-5"><div className="nav-icon">▦</div><p className="mt-4 font-black">Live stock</p><p className="mt-1 text-sm text-muted">See what is available by branch.</p></div>
              <div className="soft-card p-5"><div className="nav-icon">↗</div><p className="mt-4 font-black">Management view</p><p className="mt-1 text-sm text-muted">Spot issues before they become problems.</p></div>
            </div>
          </section>

          <section className="mx-auto w-full max-w-md">
            <div className="mb-6 lg:hidden">
              <p className="text-sm font-bold text-accent">Welcome back</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">Sign in to continue</h1>
            </div>

            <form onSubmit={handleSubmit} className="soft-card p-5 sm:p-7">
              <div className="hidden lg:block">
                <p className="text-sm font-bold text-accent">Welcome back</p>
                <h2 className="mt-2 text-3xl font-black tracking-tight">Sign in</h2>
                <p className="mt-2 text-sm text-muted">Use your staff or management account.</p>
              </div>

              {error && <div className="mt-5 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-3 text-sm text-red-400" role="alert">{error}</div>}

              <div className="mt-6">
                <label htmlFor="email" className="mb-2 block text-sm font-bold">Email address</label>
                <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="input-base" placeholder="name@example.com" />
              </div>

              <div className="mt-4">
                <label htmlFor="password" className="mb-2 block text-sm font-bold">Password</label>
                <div className="relative">
                  <input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="input-base pr-16" placeholder="Enter password" />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-2 my-auto h-fit rounded-lg px-2 py-1 text-xs font-bold text-muted">{showPassword ? 'Hide' : 'Show'}</button>
                </div>
              </div>

              <button type="submit" disabled={loading} className="btn-primary mt-6 w-full rounded-xl px-4 py-3.5 font-black disabled:opacity-50">{loading ? 'Signing in...' : 'Sign in'}</button>
              <p className="mt-5 text-center text-xs text-muted">Authorized staff only</p>
            </form>
          </section>
        </div>
      </div>
    </main>
  )
}
