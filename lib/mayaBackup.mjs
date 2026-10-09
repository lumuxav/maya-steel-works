const MAYA_PROJECT_REF = 'pgaonchvddcnlssigelt'

export function normalizeMayaBackupRecipient(recipient) {
  return typeof recipient === 'string' ? recipient.trim() : ''
}

export function validateMayaBackupConfig(databaseUrl, recipient) {
  if (typeof databaseUrl !== 'string' || typeof recipient !== 'string') {
    return 'Maya backup requires a PostgreSQL connection URL and an age public recipient.'
  }
  let address
  try {
    address = new URL(databaseUrl)
  } catch {
    return 'Database connection URL is invalid.'
  }
  const direct = address.hostname === `db.${MAYA_PROJECT_REF}.supabase.co`
    && address.username === 'postgres'
  const pooled = address.hostname.endsWith('.pooler.supabase.com')
    && address.username === `postgres.${MAYA_PROJECT_REF}`
  if (!['postgres:', 'postgresql:'].includes(address.protocol)
      || !(direct || pooled) || address.port && address.port !== '5432') {
    return 'Database URL does not identify the dedicated Maya Supabase project using a direct or session-pooler connection.'
  }
  if (!address.password) {
    return 'Maya PostgreSQL backup needs a database password.'
  }
  const sslmode = address.searchParams.get('sslmode')?.toLowerCase()
  if (sslmode && !['require','verify-ca','verify-full'].includes(sslmode)) {
    return 'Database SSL must be required.'
  }
  if (!/^age1[a-z0-9]{58}$/.test(normalizeMayaBackupRecipient(recipient))) {
    return 'Invalid age public recipient; it should begin age1 and must not be a private key.'
  }
  return null
}

export function backupArtifactSummary({ run, artifacts }) {
  if (!run || run.conclusion !== 'success') return null
  const item = (artifacts || []).find((artifact) => !artifact.expired && artifact.name?.startsWith('maya-db-encrypted-'))
  return item ? {
    completedAt: run.updated_at,
    url: run.html_url,
    artifactExpiresAt: item.expires_at ?? null,
    archiveAvailable: true,
    verifiedRestore: false,
  } : null
}
