import assert from 'node:assert/strict'

const origin = 'http://127.0.0.1:3000'
const pages = [
  '/', '/login', '/inventory', '/sales', '/customer-work',
  '/production', '/cashbook', '/stocktake', '/sales-report',
  '/alerts', '/records', '/settings', '/users', '/system-control',
  '/deliveries', '/profit', '/recipes', '/corrections'
]

let passed = 0
for (const pathname of pages) {
  const response = await fetch(origin + pathname, { signal: AbortSignal.timeout(10000), redirect: 'manual' })
  assert.equal(response.status, 200, `${pathname} returned ${response.status}`)
  const text = await response.text()
  assert.match(text, /<html/i, `${pathname} did not render HTML`)
  passed += 1
}

for (const path of ['/api/admin/users', '/api/admin/system', '/api/admin/backups', '/api/reports/period?from=2026-10-31&to=2026-10-31']) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(10000) })
  assert.equal(response.status, 401, `${path} did not block an anonymous caller`)
  passed += 1
}

console.log(`Maya HTTP smoke checks passed: ${passed}`)
