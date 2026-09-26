import { supabase } from './supabase'

let cachedUserId = null
let cachedProfile = null
let profilePromise = null

export async function getSessionProfile({ forceProfile = false } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    cachedUserId = null
    cachedProfile = null
    profilePromise = null
    return { session: null, profile: null }
  }

  const userId = session.user.id
  if (!forceProfile && cachedUserId === userId && cachedProfile) {
    return { session, profile: cachedProfile }
  }

  if (!forceProfile && profilePromise && cachedUserId === userId) {
    return { session, profile: await profilePromise }
  }

  cachedUserId = userId
  profilePromise = supabase
    .from('users')
    .select('full_name, role, branch, active')
    .eq('id', userId)
    .single()
    .then(({ data, error }) => {
      if (error) throw error
      cachedProfile = data || null
      return cachedProfile
    })
    .finally(() => {
      profilePromise = null
    })

  return { session, profile: await profilePromise }
}

export function setCachedProfile(userId, profile) {
  if (!userId) return
  cachedUserId = userId
  cachedProfile = profile || null
}

export function clearSessionProfileCache() {
  cachedUserId = null
  cachedProfile = null
  profilePromise = null
}
