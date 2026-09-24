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
    <main className="min-h-screen px-4 py-6 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl flex-col">
        <header className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-black tracking-tight">Maya Steel Works</p>
            <p className="text-xs text-muted">Management System</p>
          </div>
          <ThemePicker />
        </header>

        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm">
            <div className="mb-6">
              <h1 className="text-2xl font-black tracking-tight">Sign in</h1>
              <p className="mt-2 text-sm text-muted">Use your staff or management account.</p>
            </div>

            <form onSubmit={handleSubmit} className="surface rounded-2xl p-5 sm:p-6">
              {error && (
                <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400" role="alert">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-semibold">Email address</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className="input-base"
                  placeholder="name@example.com"
                />
              </div>

              <div className="mt-4">
                <label htmlFor="password" className="mb-2 block text-sm font-semibold">Password</label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    className="input-base pr-16"
                    placeholder="Enter password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-2 my-auto h-fit rounded-md px-2 py-1 text-xs font-bold text-muted hover:opacity-80"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary mt-5 w-full rounded-lg px-4 py-3 font-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>

            <p className="mt-4 text-center text-xs text-muted">Authorized staff only</p>
          </div>
        </div>
      </div>
    </main>
  )
}
