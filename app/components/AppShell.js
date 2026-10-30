'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { setCachedProfile, clearSessionProfileCache } from '../../lib/sessionCache'
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
    system: <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h5M8 17h3"/><circle cx="16.5" cy="16.5" r="1.5"/></>,
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
  { href: '/sales-report', label: 'Sales & Credit', icon: 'reports' },
  { href: '/profit', label: 'Period Report', icon: 'reports', managementOnly: true },
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
    let intervalId = null
    let channel = null

    const forceSignOut = async () => {
      clearSessionProfileCache()
      try { await supabase.auth.signOut() } catch {}
      window.location.replace('/login?disabled=1')
    }

    const checkAccess = async (knownUserId = null) => {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) return
      if (!session) return window.location.replace('/login')

      const id = knownUserId || session.user.id
      if (mounted) setUserId(id)

      const { data, error } = await supabase.from('users').select('full_name, role, branch, active').eq('id', id).maybeSingle()
      if (error) return
      if (!data || data.active === false) return forceSignOut()

      setCachedProfile(id, data)
      if (mounted) setProfile(data)
    }

    const load = async () => {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) return
      if (!session) return window.location.replace('/login')

      const id = session.user.id
      if (mounted) setUserId(id)
      await checkAccess(id)

      channel = supabase
        .channel(`maya-user-access-${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `id=eq.${id}` }, (payload) => {
          if (payload.eventType === 'DELETE' || payload?.new?.active === false) return forceSignOut()
          if (payload?.new) {
            setCachedProfile(id, payload.new)
            if (mounted) setProfile(payload.new)
          }
        })
        .subscribe()

      intervalId = window.setInterval(() => checkAccess(id), 15000)
    }

    const onFocus = () => checkAccess()
    const onVisibility = () => { if (document.visibilityState === 'visible') checkAccess() }

    load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      mounted = false
      if (intervalId) window.clearInterval(intervalId)
      if (channel) supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [isLogin])

  const initials = useMemo(() => {
    const name = profile?.full_name || 'Maya Steel Works'
    return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
  }, [profile])

  const active = (href) => href === '/' ? pathname === '/' : pathname.startsWith(href)
  const isSuper = profile?.role === 'super_admin'

  if (isLogin) return children

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <div className="app-brand-mark">MS</div>
          <div><strong>Maya Steel</strong><span>Works Management</span></div>
        </div>

        <nav className="app-nav">
          <p className="app-nav-label">Business workspace</p>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={`app-nav-item ${active(item.href) ? 'active' : ''}`}>
              <Icon name={item.icon} /><span>{item.label}</span>
            </Link>
          ))}

          <p className="app-nav-label app-nav-label-spaced">Business management</p>
          {MANAGEMENT.filter(item => !item.managementOnly || ['admin', 'super_admin'].includes(profile?.role)).map((item) => (
            <Link key={item.href} href={item.href} className={`app-nav-item ${active(item.href) ? 'active' : ''}`}>
              <Icon name={item.icon} /><span>{item.label}</span>
            </Link>
          ))}

          {isSuper && (
            <>
              <p className="app-nav-label app-nav-label-spaced">System administration</p>
              <Link href="/system-control" className={`app-nav-item ${active('/system-control') ? 'active' : ''}`}>
                <Icon name="system" /><span>System Control</span>
              </Link>
              <Link href="/users" className={`app-nav-item ${active('/users') ? 'active' : ''}`}>
                <Icon name="users" /><span>Users & Access</span>
              </Link>
              <Link href="/backups" className={`app-nav-item ${active('/backups') ? 'active' : ''}`}>
                <Icon name="system" /><span>Backup & Recovery</span>
              </Link>
            </>
          )}
        </nav>

        <div className="app-profile-card" aria-label="Signed-in user">
          <ProfileAvatar userId={userId} initials={initials} className="app-avatar" />
          <div className="min-w-0"><strong>{profile?.full_name || 'Account'}</strong><span>{isSuper ? 'System Super Admin' : profile?.role || 'staff'}</span></div>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-mobile-header">
          <div className="app-mobile-brand">
            {pathname !== '/' && <button type="button" className="app-mobile-back" aria-label="Go back to previous Maya page" onClick={() => window.dispatchEvent(new Event('maya-native-back'))}>
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
            </button>}
            <div className="app-brand-mark small">MS</div>
            <div><strong>Maya Steel Works</strong><span>{isSuper ? 'System Administration' : 'Management'}</span></div>
          </div>
          <ProfileAvatar userId={userId} initials={initials} className="app-avatar small" />
        </header>
        <div className="app-content">{children}</div>
      </div>

      <nav className="app-bottom-nav" aria-label="Primary navigation">
        {(isSuper ? [
          { href: '/', label: 'Home', icon: 'home' },
          { href: '/system-control', label: 'System', icon: 'system' },
          { href: '/users', label: 'Users', icon: 'users' },
          { href: '/alerts', label: 'Alerts', icon: 'alert' },
          { href: '/settings', label: 'Settings', icon: 'settings' },
        ] : [
          { href: '/', label: 'Home', icon: 'home' },
          { href: '/inventory', label: 'Stock', icon: 'stock' },
          { href: '/sales', label: 'Sales', icon: 'sales' },
          { href: '/cashbook', label: 'Cash', icon: 'cash' },
          { href: '/settings', label: 'Settings', icon: 'settings' },
        ]).map((item) => (
          <Link key={item.href} href={item.href} className={`app-bottom-item ${active(item.href) ? 'active' : ''}`}>
            <Icon name={item.icon} /><span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
