import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const SYSTEM_BRANCH = 'Maya Branch'
const ROLES = ['employee', 'admin', 'super_admin']

async function verifySuperAdmin(req) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !anonKey || !serviceKey) return { error: 'Server authentication is not fully configured.', status: 500 }

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '')
  if (!token) return { error: 'No session token sent.', status: 401 }

  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data?.user) return { error: 'Session expired — sign in again.', status: 401 }

  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: caller, error: callerError } = await adminClient.from('users').select('role, active').eq('id', data.user.id).single()

  if (callerError) return { error: callerError.message, status: 500 }
  if (caller?.role !== 'super_admin' || caller?.active === false) return { error: `Super admin only (your role: ${caller?.role || 'unknown'}).`, status: 403 }

  return { supabase: adminClient, callerId: data.user.id }
}

export async function GET(req) {
  const check = await verifySuperAdmin(req)
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status || 403 })

  const { supabase } = check
  const [{ data: profiles, error: profileError }, { data: authData, error: authError }] = await Promise.all([
    supabase.from('users').select('*').order('created_at', { ascending: true }),
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  ])

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })
  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

  const authMap = Object.fromEntries((authData?.users || []).map((user) => [user.id, user]))
  const users = (profiles || []).flatMap((profile) => {
    const auth = authMap[profile.id]
    if (!auth || auth.deleted_at || auth.user_metadata?.maya_deleted === true) return []
    return [{
      ...profile,
      email: auth.email || null,
      auth_created_at: auth.created_at || null,
      last_sign_in_at: auth.last_sign_in_at || null,
      email_confirmed_at: auth.email_confirmed_at || null,
    }]
  })

  return NextResponse.json({ ok: true, users })
}

export async function POST(req) {
  const check = await verifySuperAdmin(req)
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status || 403 })

  const { supabase } = check
  const body = await req.json()
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const fullName = String(body.full_name || '').trim()
  const requestedRole = ROLES.includes(body.role) ? body.role : 'employee'

  if (!email || !fullName || password.length < 6) return NextResponse.json({ error: 'Name, valid email and a password of at least 6 characters are required.' }, { status: 400 })

  const { data: existingAuth, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) return NextResponse.json({ error: listError.message }, { status: 400 })

  const existing = (existingAuth?.users || []).find((user) => user.user_metadata?.maya_deleted !== true && user.email?.toLowerCase() === email)
  if (existing) {
    const { data: existingProfile } = await supabase.from('users').select('id, full_name, role, active').eq('id', existing.id).maybeSingle()
    return NextResponse.json({ error: existingProfile ? `An account with ${email} already exists. Refresh the user list instead of creating it again.` : `An Auth account with ${email} already exists but its profile is incomplete. Contact the Super Admin to repair it.` }, { status: 409 })
  }

  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName, role: requestedRole, branch: SYSTEM_BRANCH } })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const { error: profileError } = await supabase.from('users').upsert({ id: data.user.id, full_name: fullName, role: requestedRole, branch: SYSTEM_BRANCH, active: true }, { onConflict: 'id' })
  if (profileError) return NextResponse.json({ error: `Auth account was created, but the user profile could not be finalized: ${profileError.message}. Do not create the same email again.` }, { status: 500 })

  return NextResponse.json({ ok: true, user_id: data.user.id })
}

export async function PATCH(req) {
  const check = await verifySuperAdmin(req)
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status || 403 })

  const { supabase, callerId } = check
  const { user_id, password, role, active } = await req.json()
  if (!user_id) return NextResponse.json({ error: 'User ID is required.' }, { status: 400 })
  if (user_id === callerId && (role !== undefined || active !== undefined)) return NextResponse.json({ error: 'You cannot change or disable your own Super Admin access from here.' }, { status: 400 })

  if (password !== undefined) {
    if (String(password).length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
    const { error } = await supabase.auth.admin.updateUserById(user_id, { password })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  if (active !== undefined) {
    const shouldActivate = Boolean(active)
    const { error: authAccessError } = await supabase.auth.admin.updateUserById(user_id, { ban_duration: shouldActivate ? 'none' : '876000h' })
    if (authAccessError) return NextResponse.json({ error: `Could not ${shouldActivate ? 'reactivate' : 'disable'} login access: ${authAccessError.message}` }, { status: 400 })
  }

  const profileChanges = {}
  if (role !== undefined) {
    if (!ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
    profileChanges.role = role
  }
  if (active !== undefined) profileChanges.active = Boolean(active)

  if (Object.keys(profileChanges).length > 0) {
    profileChanges.branch = SYSTEM_BRANCH
    const { error } = await supabase.from('users').update(profileChanges).eq('id', user_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req) {
  const check = await verifySuperAdmin(req)
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status || 403 })

  const { supabase, callerId } = check
  const { user_id } = await req.json()
  if (!user_id) return NextResponse.json({ error: 'User ID is required.' }, { status: 400 })
  if (user_id === callerId) return NextResponse.json({ error: 'You cannot delete your own Super Admin account.' }, { status: 400 })

  const { data: target, error: targetError } = await supabase.from('users').select('id, full_name').eq('id', user_id).maybeSingle()
  if (targetError) return NextResponse.json({ error: targetError.message }, { status: 400 })
  if (!target) return NextResponse.json({ error: 'User profile not found.' }, { status: 404 })

  const { data: authData, error: authError } = await supabase.auth.admin.getUserById(user_id)
  if (authError || !authData?.user) return NextResponse.json({ error: authError?.message || 'Login account not found.' }, { status: 404 })

  const existingMetadata = authData.user.user_metadata || {}
  const { error: retireError } = await supabase.auth.admin.updateUserById(user_id, {
    ban_duration: '876000h',
    user_metadata: {
      ...existingMetadata,
      maya_deleted: true,
      maya_deleted_at: new Date().toISOString(),
    },
  })
  if (retireError) return NextResponse.json({ error: `Could not permanently revoke the account: ${retireError.message}` }, { status: 400 })

  const { error: profileError } = await supabase.from('users').update({ active: false, branch: SYSTEM_BRANCH }).eq('id', user_id)
  if (profileError) return NextResponse.json({ error: `Login access was revoked, but the profile could not be archived: ${profileError.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, archived: true })
}
