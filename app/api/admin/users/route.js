import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { validateMayaPassword } from '../../../../lib/mayaPasswordPolicy.mjs'

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

const isArchivedAuth = (user) => user?.app_metadata?.maya_archived === true || user?.user_metadata?.maya_deleted === true

async function listAllAuthUsers(supabase) {
  const users = []
  const perPage = 200
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) return { error, users: [] }
    const batch = data?.users || []
    users.push(...batch)
    if (batch.length < perPage) return { error: null, users }
  }
  return { error: new Error('Too many accounts to display. Contact the system administrator.'), users: [] }
}

export async function GET(req) {
  const check = await verifySuperAdmin(req)
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status || 403 })

  const { supabase } = check
  const [{ data: profiles, error: profileError }, { users: authUsers, error: authError }] = await Promise.all([
    supabase.from('users').select('*').order('created_at', { ascending: true }),
    listAllAuthUsers(supabase)
  ])

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })
  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

  const authMap = Object.fromEntries(authUsers.map((user) => [user.id, user]))
  const users = []
  const archived_users = []

  for (const profile of profiles || []) {
    if (profile.branch && profile.branch !== SYSTEM_BRANCH) continue
    const auth = authMap[profile.id]
    if (!auth || auth.deleted_at) continue

    if (isArchivedAuth(auth)) {
      archived_users.push({
        id: profile.id,
        full_name: profile.full_name,
        email: auth.email || null,
        role: profile.role,
        archived_at: auth.app_metadata?.maya_archived_at || auth.user_metadata?.maya_deleted_at || null,
      })
      continue
    }

    users.push({
      ...profile,
      email: auth.email || null,
      auth_created_at: auth.created_at || null,
      last_sign_in_at: auth.last_sign_in_at || null,
      email_confirmed_at: auth.email_confirmed_at || null,
    })
  }

  return NextResponse.json({ ok: true, users, archived_users })
}

export async function POST(req) {
  const check = await verifySuperAdmin(req)
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status || 403 })

  const { supabase, callerId } = check
  const body = await req.json()
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const fullName = String(body.full_name || '').trim()
  const requestedRole = ROLES.includes(body.role) ? body.role : 'employee'
  const restoreArchived = body.restore_archived === true

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName) {
    return NextResponse.json({ error: 'Name and a valid email are required.' }, { status: 400 })
  }
  const passwordIssue = validateMayaPassword(password)
  if (passwordIssue) return NextResponse.json({ error: passwordIssue }, { status: 400 })
  if (body.role !== undefined && !ROLES.includes(body.role)) {
    return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
  }

  const { users: authUsers, error: listError } = await listAllAuthUsers(supabase)
  if (listError) return NextResponse.json({ error: listError.message }, { status: 400 })

  const existing = authUsers.find((user) => !user.deleted_at && user.email?.trim().toLowerCase() === email)

  if (restoreArchived && (!existing || !isArchivedAuth(existing) || existing.id !== body.archived_user_id)) {
    return NextResponse.json({ error: 'This archived account is no longer available for restoration. Refresh the page.' }, { status: 409 })
  }

  if (existing) {
    const { data: existingProfile, error: profileError } = await supabase.from('users')
      .select('id, full_name, role, active, branch').eq('id', existing.id).maybeSingle()

    if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })

    if (isArchivedAuth(existing)) {
      if (!existingProfile || existingProfile.branch !== SYSTEM_BRANCH || existingProfile.active !== false || existing.id === callerId) {
        return NextResponse.json({ error: 'The archived account cannot be restored safely. Contact the system administrator.' }, { status: 409 })
      }

      if (!restoreArchived) {
        return NextResponse.json({
          error: 'This email belongs to a previously removed Maya account. Restore that employee instead of creating a duplicate.',
          code: 'ARCHIVED_ACCOUNT',
          archived_user_id: existing.id,
          archived_full_name: existingProfile.full_name,
          archived_role: existingProfile.role,
        }, { status: 409 })
      }

      const previousUserMetadata = existing.user_metadata || {}
      const previousAppMetadata = existing.app_metadata || {}
      const now = new Date().toISOString()
      const { error: restoreError } = await supabase.auth.admin.updateUserById(existing.id, {
        password,
        ban_duration: 'none',
        user_metadata: {
          ...previousUserMetadata,
          maya_deleted: false,
          maya_deleted_at: null,
          full_name: fullName,
          role: requestedRole,
          branch: SYSTEM_BRANCH,
        },
        app_metadata: {
          ...previousAppMetadata,
          maya_archived: false,
          maya_restored_at: now,
        },
      })
      if (restoreError) return NextResponse.json({ error: `Could not restore login access: ${restoreError.message}` }, { status: 400 })

      const { data: updatedProfile, error: updateError } = await supabase.from('users')
        .update({ full_name: fullName, role: requestedRole, active: true, branch: SYSTEM_BRANCH })
        .eq('id', existing.id).eq('active', false).select('id').maybeSingle()

      if (updateError || !updatedProfile) {
        const { error: rollbackError } = await supabase.auth.admin.updateUserById(existing.id, {
          ban_duration: '876000h',
          user_metadata: previousUserMetadata,
          app_metadata: previousAppMetadata,
        })
        return NextResponse.json({
          error: rollbackError
            ? 'Restoration did not finish and automatic access rollback failed. Disable the account immediately in Supabase and contact the system administrator.'
            : 'Restoration did not finish. Login remains blocked; retry or contact the system administrator.',
        }, { status: 500 })
      }

      return NextResponse.json({ ok: true, restored: true, user_id: existing.id })
    }

    return NextResponse.json({
      error: existingProfile
        ? `An account with ${email} already exists. Use Reactivate or Reset password instead of creating another account.`
        : `An Auth account with ${email} already exists but its profile is incomplete. Contact the Super Admin to repair it.`
    }, { status: 409 })
  }

  if (restoreArchived) return NextResponse.json({ error: 'Archived account no longer exists. Refresh and try again.' }, { status: 409 })

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: requestedRole, branch: SYSTEM_BRANCH },
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const { error: profileError } = await supabase.from('users').upsert({
    id: data.user.id, full_name: fullName, role: requestedRole, branch: SYSTEM_BRANCH, active: true
  }, { onConflict: 'id' })
  if (profileError) {
    await supabase.auth.admin.updateUserById(data.user.id, { ban_duration: '876000h' })
    return NextResponse.json({
      error: `Auth account was created but the profile could not be finalized: ${profileError.message}. Login has been blocked; do not create the same email again.`
    }, { status: 500 })
  }

  return NextResponse.json({ ok: true, user_id: data.user.id })
}

export async function PATCH(req) {
  const check = await verifySuperAdmin(req)
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status || 403 })

  const { supabase, callerId } = check
  const { user_id, password, role, active } = await req.json()
  if (!user_id) return NextResponse.json({ error: 'User ID is required.' }, { status: 400 })
  if (user_id === callerId && (role !== undefined || active !== undefined)) return NextResponse.json({ error: 'You cannot change or disable your own Super Admin access from here.' }, { status: 400 })

  const { data: existingAuth, error: existingAuthError } = await supabase.auth.admin.getUserById(user_id)
  if (existingAuthError || !existingAuth?.user) {
    return NextResponse.json({ error: existingAuthError?.message || 'Account not found.' }, { status: 404 })
  }
  if (isArchivedAuth(existingAuth.user)) {
    return NextResponse.json({ error: 'This user was archived. Use Restore account to rehire them with a new password.' }, { status: 409 })
  }

  if (password !== undefined) {
    const passwordIssue = validateMayaPassword(String(password))
    if (passwordIssue) return NextResponse.json({ error: passwordIssue }, { status: 400 })
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
  const existingAppMetadata = authData.user.app_metadata || {}
  const archivedAt = new Date().toISOString()
  const { error: retireError } = await supabase.auth.admin.updateUserById(user_id, {
    ban_duration: '876000h',
    user_metadata: {
      ...existingMetadata,
      maya_deleted: true,
      maya_deleted_at: archivedAt,
    },
    app_metadata: {
      ...existingAppMetadata,
      maya_archived: true,
      maya_archived_at: archivedAt,
    },
  })
  if (retireError) return NextResponse.json({ error: `Could not permanently revoke the account: ${retireError.message}` }, { status: 400 })

  const { error: profileError } = await supabase.from('users').update({ active: false, branch: SYSTEM_BRANCH }).eq('id', user_id)
  if (profileError) return NextResponse.json({ error: `Login access was revoked, but the profile could not be archived: ${profileError.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, archived: true })
}
