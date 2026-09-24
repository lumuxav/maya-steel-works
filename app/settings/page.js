'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import ThemePicker from '../components/ThemePicker'
import ProfileAvatar, { avatarStorageKey } from '../components/ProfileAvatar'

function RowIcon({ children }) {
  return <span className="settings-row-icon">{children}</span>
}

const compressProfilePhoto = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()

  reader.onerror = () => reject(new Error('Could not read that image.'))
  reader.onload = () => {
    const image = new Image()
    image.onerror = () => reject(new Error('Could not open that image.'))
    image.onload = () => {
      try {
        const size = Math.min(image.width, image.height)
        const sx = Math.max(0, (image.width - size) / 2)
        const sy = Math.max(0, (image.height - size) / 2)
        const outputSize = 512

        const canvas = document.createElement('canvas')
        canvas.width = outputSize
        canvas.height = outputSize
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Image processing is not supported on this device.')

        ctx.drawImage(image, sx, sy, size, size, 0, 0, outputSize, outputSize)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      } catch (error) {
        reject(error)
      }
    }
    image.src = reader.result
  }

  reader.readAsDataURL(file)
})

export default function SettingsPage() {
  const [profile, setProfile] = useState(null)
  const [userId, setUserId] = useState(null)
  const [photoMessage, setPhotoMessage] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      setUserId(session.user.id)
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

  const choosePhoto = () => {
    if (!fileRef.current || photoBusy) return
    fileRef.current.value = ''
    fileRef.current.click()
  }

  const savePhoto = async (file) => {
    if (!file || !userId) return
    setPhotoMessage('')

    if (!file.type.startsWith('image/')) {
      setPhotoMessage('Please choose an image file.')
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    if (file.size > 15 * 1024 * 1024) {
      setPhotoMessage('That image is too large. Please choose one smaller than 15 MB.')
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    setPhotoBusy(true)
    setPhotoMessage('Preparing photo...')

    try {
      const compressed = await compressProfilePhoto(file)
      localStorage.setItem(avatarStorageKey(userId), compressed)
      window.dispatchEvent(new CustomEvent('maya-avatar-change', { detail: { userId } }))
      setPhotoMessage('Profile photo updated.')
    } catch (error) {
      setPhotoMessage(error?.message || 'Could not update the photo. Try another image.')
    } finally {
      setPhotoBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removePhoto = () => {
    if (!userId || photoBusy) return
    localStorage.removeItem(avatarStorageKey(userId))
    window.dispatchEvent(new CustomEvent('maya-avatar-change', { detail: { userId } }))
    if (fileRef.current) fileRef.current.value = ''
    setPhotoMessage('Profile photo removed.')
  }

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Account</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your profile, appearance and account preferences.</p>
        </div>
      </div>

      <section className="settings-profile-card settings-profile-edit-card">
        <ProfileAvatar userId={userId} initials={initials} className="settings-profile-photo" />
        <div className="settings-profile-copy">
          <h2>{profile?.full_name || 'Maya Steel Works User'}</h2>
          <p>{profile?.role || 'staff'}</p>
          <div className="settings-photo-actions">
            <button type="button" onClick={choosePhoto} disabled={photoBusy} className="settings-photo-button disabled:opacity-60">
              {photoBusy ? 'Updating...' : 'Change photo'}
            </button>
            <button type="button" onClick={removePhoto} disabled={photoBusy} className="settings-photo-button settings-photo-button-subtle disabled:opacity-60">Remove</button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => savePhoto(e.target.files?.[0])} />
          <small className="settings-photo-message">{photoMessage || 'Photos are automatically resized for your profile.'}</small>
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
