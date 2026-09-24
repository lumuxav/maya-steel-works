'use client'

import { useEffect, useState } from 'react'

const THEMES = [
  { value: 'blue', label: 'Blue' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

export default function ThemePicker({ compact = false }) {
  const [theme, setTheme] = useState('blue')

  useEffect(() => {
    const saved = localStorage.getItem('maya-theme') || 'blue'
    setTheme(saved)
    document.documentElement.dataset.theme = saved
  }, [])

  const changeTheme = (value) => {
    setTheme(value)
    localStorage.setItem('maya-theme', value)
    document.documentElement.dataset.theme = value
  }

  return (
    <div className={`theme-picker ${compact ? 'theme-picker-compact' : ''}`} aria-label="Theme">
      {THEMES.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => changeTheme(item.value)}
          className={theme === item.value ? 'theme-option theme-option-active' : 'theme-option'}
          aria-pressed={theme === item.value}
          title={`${item.label} theme`}
        >
          <span className={`theme-dot theme-dot-${item.value}`} />
          {!compact && item.label}
        </button>
      ))}
    </div>
  )
}
