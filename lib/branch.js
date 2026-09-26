export const SYSTEM_BRANCH = 'Maya Branch'

export const isSystemBranch = (branch) => !branch || branch === SYSTEM_BRANCH

const CACHE_MS = 15000
const cache = {
  users: { at: 0, value: null },
  raw: new Map(),
  finished: { at: 0, value: null },
}

const fresh = (entry) => entry?.value && Date.now() - entry.at < CACHE_MS

export function clearBranchCache() {
  cache.users = { at: 0, value: null }
  cache.raw.clear()
  cache.finished = { at: 0, value: null }
}

export async function getSystemUserIds(supabase, { force = false } = {}) {
  if (!force && fresh(cache.users)) return new Set(cache.users.value)
  const { data } = await supabase.from('users').select('id, branch')
  const ids = (data || []).filter((user) => isSystemBranch(user.branch)).map((user) => user.id)
  cache.users = { at: Date.now(), value: ids }
  return new Set(ids)
}

export async function getSystemRawIds(supabase, source = 'raw_materials_admin_view', { force = false } = {}) {
  const existing = cache.raw.get(source)
  if (!force && fresh(existing)) return new Set(existing.value)
  const { data } = await supabase.from(source).select('id, current_branch')
  const ids = (data || []).filter((item) => isSystemBranch(item.current_branch)).map((item) => item.id)
  cache.raw.set(source, { at: Date.now(), value: ids })
  return new Set(ids)
}

export async function getSystemFinishedIds(supabase, { force = false } = {}) {
  if (!force && fresh(cache.finished)) return new Set(cache.finished.value)
  const { data } = await supabase.from('finished_goods').select('id, current_branch')
  const ids = (data || []).filter((item) => isSystemBranch(item.current_branch)).map((item) => item.id)
  cache.finished = { at: Date.now(), value: ids }
  return new Set(ids)
}
