'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import ThemePicker from '../components/ThemePicker'

function RowIcon({ children }) {
  return <span className="settings-row-icon">{children}</span>
}

export default function SettingsPage() {
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const { data } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
      setProfile(data || null)
    }
    load()
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const initials = (profile?.full_name || 'MS').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Account</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage appearance and account preferences.</p>
        </div>
      </div>

      <section className="settings-profile-card">
        <div className="settings-avatar">{initials}</div>
        <div className="min-w-0">
          <h2>{profile?.full_name || 'Maya Steel Works User'}</h2>
          <p>{profile?.role || 'staff'}</p>
        </div>
      </section>

      <section className="settings-section">
        <h3>Appearance</h3>
        <div className="settings-appearance-card">
          <div>
            <strong>Theme</strong>
            <p>Choose how Maya Steel Works looks on this device.</p>
          </div>
          <ThemePicker />
        </div>
      </section>

      <section className="settings-section">
        <h3>Preferences</h3>
        <div className="settings-list">
          <div className="settings-row">
            <RowIcon>◎</RowIcon>
            <div><strong>Notifications</strong><p>Alert and activity preferences</p></div>
            <span className="settings-badge">Coming soon</span>
          </div>
          <div className="settings-row">
            <RowIcon>▣</RowIcon>
            <div><strong>Display & data</strong><p>Number formatting and dashboard preferences</p></div>
            <span className="settings-chevron">›</span>
          </div>
          <div className="settings-row">
            <RowIcon>?</RowIcon>
            <div><strong>Help</strong><p>System guidance and support</p></div>
            <span className="settings-chevron">›</span>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3>Account</h3>
        <div className="settings-list">
          <button type="button" onClick={signOut} className="settings-row settings-danger-row">
            <RowIcon>↗</RowIcon>
            <div><strong>Sign out</strong><p>Sign out of this device</p></div>
            <span className="settings-chevron">›</span>
          </button>
        </div>
      </section>

      <p className="settings-version">Maya Steel Works Management</p>
    </main>
  )
}
