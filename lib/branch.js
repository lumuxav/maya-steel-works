export const SYSTEM_BRANCH = 'Maya Branch'

export const isSystemBranch = (branch) => !branch || branch === SYSTEM_BRANCH

export async function getSystemUserIds(supabase) {
  const { data } = await supabase.from('users').select('id, branch')
  return new Set((data || []).filter((user) => isSystemBranch(user.branch)).map((user) => user.id))
}

export async function getSystemRawIds(supabase, source = 'raw_materials_admin_view') {
  const { data } = await supabase.from(source).select('id, current_branch')
  return new Set((data || []).filter((item) => isSystemBranch(item.current_branch)).map((item) => item.id))
}

export async function getSystemFinishedIds(supabase) {
  const { data } = await supabase.from('finished_goods').select('id, current_branch')
  return new Set((data || []).filter((item) => isSystemBranch(item.current_branch)).map((item) => item.id))
}
