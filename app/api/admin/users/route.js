import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const SYSTEM_BRANCH = 'Maya Branch'
const ROLES = ['employee', 'admin', 'super_admin']

async function verifySuperAdmin(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '')
  if (!token) return { error: 'No session token sent — refresh the page and sign in again.' }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return { error: 'Session expired — sign in again.' }

  const { data: caller } = await supabase
    .from('users')
    .select('role, active')
    .eq('id', data.user.id)
    .single()

  if (caller?.role !== 'super_admin' || caller?.active === false) {
    return { error: `Super admin only (your role: ${caller?.role || 'unknown'}).` }
  }

  return { supabase, callerId: data.user.id }
}

export async function GET(req) {
  const check = await verifySuperAdmin(req)
  if (check.error) return NextResponse.json({ error: check.error }, { status: 403 })

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
    return {
      ...profile,
      email: auth?.email || null,
      auth_created_at: auth?.created_at || null,
      last_sign_in_at: auth?.last_sign_in_at || null,
      email_confirmed_at: auth?.email_confirmed_at || null,
    }
  })

  return NextResponse.json({ ok: true, users })
}

export async function POST(req) {
  const check = await verifySuperAdmin(req)
  if (check.error) return NextResponse.json({ error: check.error }, { status: 403 })

  const { supabase } = check
  const { email, password, full_name, role } = await req.json()
  const requestedRole = ROLES.includes(role) ? role : 'employee'

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const { error: profileError } = await supabase.from('users').insert({
    id: data.user.id,
    full_name,
    role: requestedRole,
    branch: SYSTEM_BRANCH,
    active: true
  })

  if (profileError) {
    await supabase.auth.admin.deleteUser(data.user.id)
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}

export async function PATCH(req) {
  const check = await verifySuperAdmin(req)
  if (check.error) return NextResponse.json({ error: check.error }, { status: 403 })

  const { supabase, callerId } = check
  const { user_id, password, role, active } = await req.json()
  if (!user_id) return NextResponse.json({ error: 'User ID is required.' }, { status: 400 })

  if (user_id === callerId && (role !== undefined || active !== undefined)) {
    return NextResponse.json({ error: 'You cannot change or disable your own Super Admin access from here.' }, { status: 400 })
  }

  if (password !== undefined) {
    if (String(password).length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
    }
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
