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
  const users = (profiles || []).map((profile) => {
    const auth = authMap[profile.id]
    return { ...profile, email: auth?.email || null, auth_created_at: auth?.created_at || null, last_sign_in_at: auth?.last_sign_in_at || null, email_confirmed_at: auth?.email_confirmed_at || null }
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

  const existing = (existingAuth?.users || []).find((user) => user.email?.toLowerCase() === email)
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

  const refs = [
    ['sales', 'sold_by', 'sales'], ['expenses', 'recorded_by', 'expenses'], ['bankings', 'recorded_by', 'banking records'],
    ['bankings', 'confirmed_by', 'banking confirmations'], ['debt_events', 'received_by', 'debt/payment records'],
    ['deliveries', 'received_by', 'deliveries'], ['corrections_log', 'changed_by', 'correction audit records'],
    ['production_recipes', 'created_by', 'production recipes'], ['expense_categories', 'created_by', 'expense categories']
  ]

  const activity = []
  for (const [table, column, label] of refs) {
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq(column, user_id)
    if (error) return NextResponse.json({ error: `Could not verify ${label}: ${error.message}` }, { status: 500 })
    if ((count || 0) > 0) activity.push(`${count} ${label}`)
  }

  if (activity.length) return NextResponse.json({ error: `${target.full_name || 'This user'} has business history (${activity.join(', ')}). Disable the account instead so historical records remain traceable.`, has_history: true, activity }, { status: 409 })

  const { error: authError } = await supabase.auth.admin.deleteUser(user_id)
  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

  const { error: profileError } = await supabase.from('users').delete().eq('id', user_id)
  if (profileError) return NextResponse.json({ error: `Login account was deleted, but the local profile could not be cleaned up: ${profileError.message}` }, { status: 500 })

  return NextResponse.json({ ok: true })
}
