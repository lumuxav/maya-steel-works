import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateMayaBackupConfig, backupArtifactSummary } from '../lib/mayaBackup.mjs'

const recipient = 'age1' + 'q'.repeat(58)
const mayaUrl = 'postgresql://postgres:secret%231@db.pgaonchvddcnlssigelt.supabase.co:5432/postgres?sslmode=require'
const mayaPool = 'postgresql://postgres.pgaonchvddcnlssigelt:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require'

test('accepts only Maya direct Supabase PostgreSQL connection', () => assert.equal(validateMayaBackupConfig(mayaUrl, recipient), null))
test('accepts dedicated Maya session pooler', () => assert.equal(validateMayaBackupConfig(mayaPool, recipient), null))
test('rejects Universal or any other project database', () => assert.ok(validateMayaBackupConfig(mayaUrl.replaceAll('pgaonchvddcnlssigelt','otherprojectref'), recipient)))
test('rejects a different project through pooler username', () => assert.ok(validateMayaBackupConfig(mayaPool.replaceAll('pgaonchvddcnlssigelt','otherref'), recipient)))
test('rejects unencrypted PostgreSQL URL', () => assert.ok(validateMayaBackupConfig(mayaUrl.replace('sslmode=require','sslmode=disable'), recipient)))
test('rejects transaction pooler port 6543', () => assert.ok(validateMayaBackupConfig(mayaPool.replace('5432','6543'), recipient)))
test('rejects absent connection password', () => assert.ok(validateMayaBackupConfig(mayaUrl.replace('secret%231',''), recipient)))
test('rejects invalid/absent recipient key', () => assert.ok(validateMayaBackupConfig(mayaUrl, 'bad age recipient')))
test('rejects age secret identities in place of recipient', () => assert.ok(validateMayaBackupConfig(mayaUrl,'AGE-SECRET-KEY-1EXAMPLE')))
test('rejects arbitrary HTTPS URL', () => assert.ok(validateMayaBackupConfig('https://example.com',recipient)))
test('rejects nonstring inputs', () => assert.ok(validateMayaBackupConfig(undefined,undefined)))

const backup = { conclusion:'success', updated_at:'2026-10-10T10:00:00Z', html_url:'https://github.com/lumuxav/maya-steel-works/actions/runs/123' }
test('reports valid unexpired encrypted artifact', () => {
  const value = backupArtifactSummary({run:backup,artifacts:[{name:'maya-db-encrypted-123',expired:false,expires_at:'2026-10-13T10:00:00Z'}]})
  assert.equal(value?.archiveAvailable,true)
  assert.equal(value?.verifiedRestore,false)
})
test('does not claim an expired backup is available', () => assert.equal(backupArtifactSummary({run:backup,artifacts:[{name:'maya-db-encrypted-123',expired:true}]}),null))
test('does not count successful job without encrypted artifact', () => assert.equal(backupArtifactSummary({run:backup,artifacts:[]}),null))
test('rejects failed backup runs', () => assert.equal(backupArtifactSummary({run:{...backup,conclusion:'failure'},artifacts:[{name:'maya-db-encrypted-123',expired:false}]}),null))

const workflow = readFileSync('.github/workflows/maya-encrypted-backup.yml','utf8')
const script = readFileSync('scripts/create-encrypted-maya-backup.sh','utf8')
test('scheduled backups stay disabled until Super Admin enables them', () => assert.match(workflow,/vars\.MAYA_BACKUPS_ENABLED == 'true'/))
test('daily automatic backups only use the Maya secret and public age recipient', () => {
  assert.match(workflow,/secrets\.MAYA_BACKUP_DATABASE_URL/)
  assert.match(workflow,/vars\.MAYA_BACKUP_AGE_RECIPIENT/)
  assert.match(workflow,/cron: '53 22 \* \* \*'/)
})
test('workflows upload only encrypted age archives with short retention', () => {
  assert.match(workflow,/path: maya-backup-output\/\*\.age/)
  assert.match(workflow,/retention-days: 3/)
  assert.doesNotMatch(workflow,/path: .*\.dump/)
})
test('unencrypted pg_dump lives only inside temporary directory', () => {
  assert.match(script,/WORK="\$\(mktemp -d\)"/)
  assert.match(script,/trap cleanup EXIT/)
  assert.match(script,/pg_restore --list/)
  assert.match(script,/age -r/)
})
