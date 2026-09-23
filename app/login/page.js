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
      setError('🔒 This account has been deactivated — contact management.')
      await supabase.auth.signOut()
      setLoading(false)
      return
    }

    router.replace('/')
  }

  return (
    <main className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="bg-slate-800 rounded-xl p-8 w-full max-w-md space-y-5 border border-slate-700">
        <div className="text-center mb-2">
          <h1 className="text-2xl font-black text-white">MAYA STEEL WORKS</h1>
          <p className="text-slate-400 text-sm mt-1">Precision Metal Cutting & Pressing Solutions</p>
        </div>

        {error && (
          <div className="rounded-lg p-3 text-sm bg-red-900/50 text-red-200 border border-red-700">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2"
            placeholder="you@mayasteelworks.com" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
            className="w-full rounded-lg bg-slate-700 border border-slate-600 text-white px-3 py-2"
            placeholder="••••••••" />
        </div>

        <button type="submit" disabled={loading}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-bold py-3 rounded-lg">
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </main>
  )
}