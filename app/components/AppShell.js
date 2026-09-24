'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import ProfileAvatar from './ProfileAvatar'

const Icon = ({ name }) => {
  const paths = {
    home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/></>,
    stock: <><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></>,
    sales: <><path d="M4 18h16"/><path d="M6 15V9M12 15V5M18 15v-3"/></>,
    service: <><path d="M14.5 5.5 18.5 9.5"/><path d="M13 7 6 14l-1 4 4-1 7-7"/><path d="M4 20h16"/></>,
    production: <><path d="M4 18h16V9l-5 3V8l-5 3V5L4 9z"/><path d="M7 18v-3h3v3"/></>,
    cash: <><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9h.01M18 15h.01"/></>,
    reports: <><path d="M5 20V10M12 20V4M19 20v-7"/></>,
    alert: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 14H3v-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-1.5A4.5 4.5 0 0 1 8 14h2a4.5 4.5 0 0 1 4.5 4.5V20"/><path d="M16 5.5a3 3 0 0 1 0 5.5M17 14a4 4 0 0 1 3.5 4v2"/></>,
  }
  return <svg viewBox="0 0 24 24" className="app-icon" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.home}</svg>
}

const NAV = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/inventory', label: 'Inventory', icon: 'stock' },
  { href: '/sales', label: 'Sales', icon: 'sales' },
  { href: '/customer-work', label: 'Customer Material', icon: 'service' },
  { href: '/production', label: 'Production', icon: 'production' },
  { href: '/cashbook', label: 'Cash & Banking', icon: 'cash' },
]

const MANAGEMENT = [
  { href: '/alerts', label: 'Alerts', icon: 'alert' },
  { href: '/sales-report', label: 'Reports', icon: 'reports' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
]

export default function AppShell({ children }) {
  const pathname = usePathname()
  const [profile, setProfile] = useState(null)
  const [userId, setUserId] = useState(null)
  const isLogin = pathname === '/login'

  useEffect(() => {
    if (isLogin) return
    let mounted = true
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      if (mounted) setUserId(session.user.id)
      const { data } = await supabase.from('users').select('full_name, role').eq('id', session.user.id).single()
      if (mounted) setProfile(data || null)
    }
    load()
    return () => { mounted = false }
  }, [isLogin])

  const initials = useMemo(() => {
    const name = profile?.full_name || 'Maya Steel Works'
    return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
  }, [profile])

  const active = (href) => href === '/' ? pathname === '/' : pathname.startsWith(href)

  if (isLogin) return children

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <div className="app-brand-mark">MS</div>
          <div>
            <strong>Maya Steel</strong>
            <span>Works Management</span>
          </div>
        </div>

        <nav className="app-nav">
          <p className="app-nav-label">Workspace</p>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={`app-nav-item ${active(item.href) ? 'active' : ''}`}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}

          <p className="app-nav-label app-nav-label-spaced">Management</p>
          {MANAGEMENT.map((item) => (
            <Link key={item.href} href={item.href} className={`app-nav-item ${active(item.href) ? 'active' : ''}`}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}

          {profile?.role === 'super_admin' && (
            <Link href="/users" className={`app-nav-item ${active('/users') ? 'active' : ''}`}>
              <Icon name="users" />
              <span>Users & Roles</span>
            </Link>
          )}
        </nav>

        <div className="app-profile-card" aria-label="Signed-in user">
          <ProfileAvatar userId={userId} initials={initials} className="app-avatar" />
          <div className="min-w-0">
            <strong>{profile?.full_name || 'Account'}</strong>
            <span>{profile?.role || 'staff'}</span>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-mobile-header">
          <div className="app-mobile-brand">
            <div className="app-brand-mark small">MS</div>
            <div><strong>Maya Steel Works</strong><span>Management</span></div>
          </div>
          <ProfileAvatar userId={userId} initials={initials} className="app-avatar small" />
        </header>

        <div className="app-content">{children}</div>
      </div>

      <nav className="app-bottom-nav" aria-label="Primary navigation">
        {[
          { href: '/', label: 'Home', icon: 'home' },
          { href: '/inventory', label: 'Stock', icon: 'stock' },
          { href: '/sales', label: 'Sales', icon: 'sales' },
          { href: '/cashbook', label: 'Cash', icon: 'cash' },
          { href: '/settings', label: 'Settings', icon: 'settings' },
        ].map((item) => (
          <Link key={item.href} href={item.href} className={`app-bottom-item ${active(item.href) ? 'active' : ''}`}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}