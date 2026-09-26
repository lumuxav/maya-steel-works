'use client'

import { useEffect, useState } from 'react'

export const avatarStorageKey = (userId) => `maya-profile-photo:${userId || 'guest'}`

export default function ProfileAvatar({ userId, initials = 'MS', className = '' }) {
  const [photo, setPhoto] = useState(null)

  useEffect(() => {
    if (!userId) return

    const load = () => {
      try {
        setPhoto(localStorage.getItem(avatarStorageKey(userId)))
      } catch {
        setPhoto(null)
      }
    }

    load()
    const onChange = (event) => {
      if (!event.detail || event.detail.userId === userId) load()
    }
    window.addEventListener('maya-avatar-change', onChange)
    window.addEventListener('storage', load)
    return () => {
      window.removeEventListener('maya-avatar-change', onChange)
      window.removeEventListener('storage', load)
    }
  }, [userId])

  return (
    <span className={`profile-avatar ${photo ? 'profile-avatar-has-photo' : ''} ${className}`.trim()}>
      {photo ? <img src={photo} alt="Profile" /> : <span>{initials}</span>}
    </span>
  )
}
