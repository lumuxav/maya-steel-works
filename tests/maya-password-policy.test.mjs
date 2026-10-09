import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMayaPassword } from '../lib/mayaPasswordPolicy.mjs'

test('accepts a sufficiently strong employee password', () => assert.equal(validateMayaPassword('Kampala#Works2026!'),null))
test('rejects passwords under 12 characters', () => assert.ok(validateMayaPassword('Maya#2026')))
test('rejects missing uppercase', () => assert.ok(validateMayaPassword('maya#system2026')))
test('rejects missing lowercase', () => assert.ok(validateMayaPassword('MAYA#SYSTEM2026')))
test('rejects missing numbers', () => assert.ok(validateMayaPassword('Maya#SystemStrong')))
test('rejects missing symbols', () => assert.ok(validateMayaPassword('MayaSystem2026')))
test('rejects surrounding whitespace', () => assert.ok(validateMayaPassword(' Maya#System2026')))
test('rejects very long passwords', () => assert.ok(validateMayaPassword('Aaaa12#'+ 'x'.repeat(130))))
test('rejects absent passwords', () => assert.ok(validateMayaPassword(undefined)))
