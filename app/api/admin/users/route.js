import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const SYSTEM_BRANCH = 'Maya Branch'

async function verifySuperAdmin(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY — add it to .env.local and restart the server.' }
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '')
  if (!token) return { error: 'No session token sent — refresh the page and sign in again.' }
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return { error: 'Session expired — sign in again.' }
  const { data: caller } = await supabase.from('users').select('role').eq('id', data.user.id).single()
  if (caller?.role !== 'super_admin') return { error: `Super admin only (your role: ${caller?.role || 'unknown'}).` }
  return { supabase }
}

export async function POST(req) {
  const check = await verifySuperAdmin(req)
  if (check.error) return NextResponse.json({ error: check.error }, { status: 403 })
  const supabase = check.supabase
  const { email, password, full_name, role } = await req.json()
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  const { error: pErr } = await supabase.from('users').insert({ id: data.user.id, full_name, role, branch: SYSTEM_BRANCH, active: true })
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req) {
  const check = await verifySuperAdmin(req)
  if (check.error) return NextResponse.json({ error: check.error }, { status: 403 })
  const supabase = check.supabase
  const { user_id, password } = await req.json()
  const { error } = await supabase.auth.admin.updateUserById(user_id, { password })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
