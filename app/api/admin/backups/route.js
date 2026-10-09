import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { backupArtifactSummary } from '../../../../lib/mayaBackup.mjs'

export const dynamic = 'force-dynamic'

const ROOT = 'https://api.github.com/repos/lumuxav/maya-steel-works'

async function githubRead(path, token) {
  const response = await fetch(ROOT + path, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('Unable to retrieve the private GitHub backup history. Check token permissions.')
  return response.json()
}

export async function GET(req) {
  const headers = { 'Cache-Control': 'no-store' }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service) {
    return NextResponse.json({ ok: false, error: 'Maya authentication configuration is incomplete.' }, { status: 503, headers })
  }
  const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '')
  if (!token) return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401, headers })

  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await auth.auth.getUser(token)
  if (error || !data?.user) {
    return NextResponse.json({ ok: false, error: 'Session expired.' }, { status: 401, headers })
  }

  const database = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: profile, error: profileError } = await database.from('users')
    .select('role, active, branch').eq('id', data.user.id).single()
  if (profileError) return NextResponse.json({ ok: false, error: 'Unable to verify Maya staff permissions.' }, { status: 503, headers })
  if (profile?.role !== 'super_admin' || profile.active !== true || profile.branch !== 'Maya Branch') {
    return NextResponse.json({ ok: false, error: 'System Super Admin only.' }, { status: 403, headers })
  }

  const githubToken = process.env.MAYA_GITHUB_BACKUP_READ_TOKEN
  if (!githubToken) {
    return NextResponse.json({
      ok: true, configured: false, latest: null,
      note: 'Connect a read-only GitHub Actions token in Vercel to display verified run dates. Check the GitHub Actions page directly meanwhile.',
    }, { headers })
  }

  try {
    const list = await githubRead('/actions/workflows/maya-encrypted-backup.yml/runs?status=success&per_page=8', githubToken)
    for (const run of list.workflow_runs || []) {
      if (run.head_branch !== 'main' || run.conclusion !== 'success') continue
      const art = await githubRead(`/actions/runs/${run.id}/artifacts?per_page=30`, githubToken)
      const summary = backupArtifactSummary({ run, artifacts: art.artifacts })
      if (summary) return NextResponse.json({ ok: true, configured: true, latest: summary }, { headers })
    }
    return NextResponse.json({
      ok: true, configured: true, latest: null,
      note: 'No current encrypted backup artifact exists. Check the workflow or artifact expiration.',
    }, { headers })
  } catch {
    return NextResponse.json({
      ok: false, configured: true,
      error: 'Private GitHub backup status could not be verified. Open the GitHub Actions workflow and check the credential permissions.',
    }, { status: 503, headers })
  }
}
