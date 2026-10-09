'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

const EXIT_WINDOW_MS = 2200

export default function NativeBackNavigation() {
  const pathname = usePathname()
  const router = useRouter()
  const currentPathRef = useRef(pathname || '/')
  const routeStackRef = useRef([])
  const pendingBackRef = useRef(null)
  const lastExitPressRef = useRef(0)
  const exitTimerRef = useRef(null)
  const [showExitHint, setShowExitHint] = useState(false)

  useEffect(() => {
    const currentPath = pathname || '/'
    currentPathRef.current = currentPath

    if (currentPath === '/login') {
      routeStackRef.current = ['/login']
      pendingBackRef.current = null
      return
    }

    if (routeStackRef.current.length === 0) {
      routeStackRef.current = currentPath === '/' ? ['/'] : ['/', currentPath]
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

    const setup = async () => {
      const capacitor = window.Capacitor
      if (!capacitor?.isNativePlatform?.()) return

      const app = capacitor.Plugins?.App || capacitor.registerPlugin?.('App')
      if (!app?.addListener) return

      try {
        listener = await app.addListener('backButton', () => {
          const currentPath = currentPathRef.current || '/'
          const onExitScreen = currentPath === '/' || currentPath === '/login'

          if (onExitScreen) {
            const now = Date.now()
            if (now - lastExitPressRef.current <= EXIT_WINDOW_MS) {
              lastExitPressRef.current = 0
              setShowExitHint(false)
              if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current)
              app.exitApp?.()
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
          const stack = routeStackRef.current
          if (stack[stack.length - 1] === currentPath) stack.pop()
          const previous = stack[stack.length - 1] || '/'
          pendingBackRef.current = previous
          if (stack.length === 0) routeStackRef.current = ['/']
          router.replace(previous)
        })

        if (cancelled) listener?.remove?.()
      } catch {
        listener = null
      }
    }

    setup()

    return () => {
      cancelled = true
      listener?.remove?.()
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current)
    }
  }, [router])

  return showExitHint ? (
    <div className="maya-exit-toast" role="status" aria-live="polite">
      Press Back again to exit Maya
    </div>
  ) : null
}
