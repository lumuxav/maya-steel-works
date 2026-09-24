'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

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

    const { data: prof } = await supabase
      .from('users')
      .select('full_name, role, active')
      .eq('id', data.user.id)
      .single()

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
    <main className="min-h-screen px-4 py-8 sm:px-6 flex items-center justify-center">
      <div className="w-full max-w-5xl grid lg:grid-cols-[1.05fr_0.95fr] overflow-hidden rounded-3xl border border-slate-700/70 bg-slate-950/65 shadow-2xl shadow-black/30 backdrop-blur">
        <section className="hidden lg:flex min-h-[620px] flex-col justify-between p-12 bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/40 border-r border-slate-700/60">
          <div>
            <div className="inline-flex items-center gap-3 rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Operations Management
            </div>
            <h1 className="mt-8 max-w-xl text-5xl font-black leading-[1.04] tracking-tight text-white">
              Maya Steel Works
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-8 text-slate-300">
              One secure workspace for stock, production, sales, banking, discrepancies and management reporting.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-2xl border border-slate-700/60 bg-slate-950/40 p-5">
              <p className="text-slate-500">Built for</p>
              <p className="mt-1 font-bold text-white">Daily operations</p>
            </div>
            <div className="rounded-2xl border border-slate-700/60 bg-slate-950/40 p-5">
              <p className="text-slate-500">Access</p>
              <p className="mt-1 font-bold text-white">Role controlled</p>
            </div>
          </div>
        </section>

        <section className="flex min-h-[620px] items-center p-6 sm:p-10 lg:p-12">
          <form onSubmit={handleSubmit} className="w-full max-w-md mx-auto">
            <div className="lg:hidden mb-8">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">Maya Steel Works</p>
              <h1 className="mt-2 text-3xl font-black text-white">Management System</h1>
            </div>

            <div>
              <p className="text-sm font-semibold text-amber-400">Secure staff access</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-white">Welcome back</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">Sign in with your authorized Maya Steel Works account.</p>
            </div>

            {error && (
              <div className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200" role="alert">
                {error}
              </div>
            )}

            <div className="mt-7 space-y-5">
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-semibold text-slate-300">Email address</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className="w-full rounded-xl border border-slate-600 bg-slate-900/80 px-4 py-3.5 text-white placeholder:text-slate-600 transition focus:border-amber-400"
                  placeholder="you@mayasteelworks.com"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-semibold text-slate-300">Password</label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    className="w-full rounded-xl border border-slate-600 bg-slate-900/80 px-4 py-3.5 pr-20 text-white placeholder:text-slate-600 transition focus:border-amber-400"
                    placeholder="Enter password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-3 my-auto h-fit rounded-lg px-2 py-1 text-xs font-bold text-slate-400 hover:text-white"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-7 w-full rounded-xl bg-amber-400 px-4 py-3.5 font-black text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in to dashboard'}
            </button>

            <p className="mt-6 text-center text-xs leading-5 text-slate-500">
              Access is limited to authorized staff and management accounts.
            </p>
          </form>
        </section>
      </div>
    </main>
  )
}
