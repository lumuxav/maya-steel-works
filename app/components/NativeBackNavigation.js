'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

const EXIT_WINDOW_MS = 2200
const DEDUPLICATION_MS = 250

export default function NativeBackNavigation() {
  const pathname = usePathname()
  const router = useRouter()
  const currentPathRef = useRef(pathname || '/')
  const routeStackRef = useRef([])
  const pendingBackRef = useRef(null)
  const lastHandledBackRef = useRef(0)
  const lastExitPressRef = useRef(0)
  const exitTimerRef = useRef(null)
  const [showExitHint, setShowExitHint] = useState(false)

  useEffect(() => {
    const currentPath = pathname || '/'
    currentPathRef.current = currentPath

    if (currentPath === '/login') {
      routeStackRef.current = ['/login']
      pendingBackRef.current = null
      lastExitPressRef.current = 0
      return
    }

    if (routeStackRef.current.length === 0 || routeStackRef.current[0] === '/login') {
      routeStackRef.current = currentPath === '/' ? ['/'] : ['/', currentPath]
      pendingBackRef.current = null
      return
    }

    if (pendingBackRef.current === currentPath) {
      pendingBackRef.current = null
      return
    }

    pendingBackRef.current = null
    const stack = routeStackRef.current
    if (stack[stack.length - 1] !== currentPath) {
      stack.push(currentPath)
      if (stack.length > 40) stack.splice(1, stack.length - 40)
    }

    lastExitPressRef.current = 0
    setShowExitHint(false)
  }, [pathname])

  useEffect(() => {
    let listener = null
    let cancelled = false
    let retryTimer = null
    let attempts = 0

    const handleBack = (app) => {
      const now = Date.now()
      if (now - lastHandledBackRef.current < DEDUPLICATION_MS) return
      lastHandledBackRef.current = now

      const currentPath = currentPathRef.current || '/'
      if (currentPath === '/' || currentPath === '/login') {
        if (now - lastExitPressRef.current <= EXIT_WINDOW_MS) {
          lastExitPressRef.current = 0
          setShowExitHint(false)
          if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current)
          app?.exitApp?.()
          return
        }

        lastExitPressRef.current = now
        setShowExitHint(true)
        if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current)
        exitTimerRef.current = window.setTimeout(() => {
          lastExitPressRef.current = 0
          setShowExitHint(false)
        }, EXIT_WINDOW_MS)
        return
      }

      lastExitPressRef.current = 0
      setShowExitHint(false)
      if (pendingBackRef.current) return

      const stack = routeStackRef.current
      if (stack[stack.length - 1] === currentPath) stack.pop()
      const previous = stack[stack.length - 1] || '/'
      pendingBackRef.current = previous
      if (stack.length === 0) routeStackRef.current = ['/']
      router.replace(previous)
    }

    const nativeBack = () => handleBack(window.Capacitor?.Plugins?.App)
    window.__mayaBackListenerReady = true
    window.addEventListener('maya-native-back', nativeBack)

    const connect = async () => {
      if (cancelled) return
      const capacitor = window.Capacitor
      if (!capacitor?.isNativePlatform?.()) {
        if (attempts++ < 40) retryTimer = window.setTimeout(connect, 250)
        return
      }

      const app = capacitor.Plugins?.App || capacitor.registerPlugin?.('App')
      if (!app?.addListener) {
        if (attempts++ < 40) retryTimer = window.setTimeout(connect, 250)
        return
      }

      try {
        listener = await app.addListener('backButton', () => handleBack(app))
        if (cancelled) listener?.remove?.()
      } catch {
        if (attempts++ < 40) retryTimer = window.setTimeout(connect, 250)
      }
    }

    connect()
    return () => {
      cancelled = true
      window.__mayaBackListenerReady = false
      window.removeEventListener('maya-native-back', nativeBack)
      if (retryTimer) window.clearTimeout(retryTimer)
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current)
      listener?.remove?.()
    }
  }, [router])

  return showExitHint ? (
    <div className="maya-exit-toast" role="status" aria-live="polite">
      Press Back again to exit Maya
    </div>
  ) : null
}
