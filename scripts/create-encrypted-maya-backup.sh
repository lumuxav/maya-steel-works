#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ -z "${MAYA_BACKUP_DATABASE_URL:-}" || -z "${MAYA_BACKUP_AGE_RECIPIENT:-}" ]]; then
  echo "::error::Configure MAYA_BACKUP_DATABASE_URL (secret) and MAYA_BACKUP_AGE_RECIPIENT (repository variable)." >&2
  exit 1
fi

node --input-type=module -e '
import { validateMayaBackupConfig } from "./lib/mayaBackup.mjs"
const issue = validateMayaBackupConfig(process.env.MAYA_BACKUP_DATABASE_URL, process.env.MAYA_BACKUP_AGE_RECIPIENT)
if (issue) { console.error("::error::" + issue); process.exit(1) }
'

command -v pg_dump >/dev/null || { echo "::error::pg_dump missing"; exit 1; }
command -v pg_restore >/dev/null || { echo "::error::pg_restore missing"; exit 1; }
command -v age >/dev/null || { echo "::error::age encryption missing"; exit 1; }

CLIENT_VERSION="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
if (( CLIENT_VERSION < 17 )); then
  echo "::error::Use PostgreSQL pg_dump 17 or newer for Maya's PostgreSQL 17 database." >&2
  exit 1
fi

export PGSSLMODE=require
WORK="$(mktemp -d)"
OUTPUT_DIR="$PWD/maya-backup-output"
mkdir -p "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR"
cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$WORK/maya-postgres.dump"
ARCHIVE="$WORK/maya-backup.tar"
ENCRYPTED="$OUTPUT_DIR/maya-steel-works-$STAMP.tar.age"

echo "Creating consistent, read-only PostgreSQL backup for the dedicated Maya database..."
pg_dump \
  --dbname="$MAYA_BACKUP_DATABASE_URL" \
  --format=custom \
  --no-owner --no-acl \
  --serializable-deferrable \
  --lock-wait-timeout=10000 \
  --file="$DUMP"

if [[ ! -s "$DUMP" ]]; then
  echo "::error::Database backup is empty." >&2
  exit 1
fi
pg_restore --list "$DUMP" > "$WORK/dump-index.txt"
if ! grep -Eq 'TABLE DATA public sales ' "$WORK/dump-index.txt"; then
  echo "::error::Maya sales table missing from dump index. Backup rejected." >&2
  exit 1
fi
if ! grep -Eq 'TABLE DATA auth users ' "$WORK/dump-index.txt"; then
  echo "::error::Supabase Auth users not found in dump index. Backup rejected as incomplete." >&2
  exit 1
fi

node --input-type=module -e '
import fs from "node:fs"
import crypto from "node:crypto"
const data = fs.readFileSync(process.argv[1])
const meta = {
  product: "Maya Steel Works",
  scope: "Maya Supabase database only; Storage objects are separate",
  database_project_ref: "pgaonchvddcnlssigelt",
  created_at: new Date().toISOString(),
  format: "PostgreSQL custom archive (pg_restore -l, pg_restore --dbname)",
  source_git_revision: process.env.GITHUB_SHA || "manual",
  sha256_dump: crypto.createHash("sha256").update(data).digest("hex"),
  dump_bytes: data.length,
  restore_verified: false
}
fs.writeFileSync(process.argv[2], JSON.stringify(meta, null, 2) + "\n", {mode: 0o600})
' "$DUMP" "$WORK/manifest.json"

tar -C "$WORK" -cf "$ARCHIVE" maya-postgres.dump manifest.json
age -r "$MAYA_BACKUP_AGE_RECIPIENT" -o "$ENCRYPTED" "$ARCHIVE"
if [[ ! -s "$ENCRYPTED" ]]; then
  echo "::error::Encrypted backup was not generated." >&2
  exit 1
fi

BYTES="$(stat -c %s "$ENCRYPTED")"
if (( BYTES > 62914560 )); then
  rm -f "$ENCRYPTED"
  echo "::error::Encrypted backup exceeds 60 MiB free artifact safety limit. Do not downgrade encryption; switch to a reviewed offline destination." >&2
  exit 1
fi

if ! head -c 30 "$ENCRYPTED" | grep -q "age-encryption.org/v1"; then
  rm -f "$ENCRYPTED"
  echo "::error::Encrypted archive does not have the expected age header." >&2
  exit 1
fi

echo "Maya encrypted backup created, PostgreSQL archive structure checked, total encrypted bytes: $BYTES."
echo "### Maya encrypted database backup" >> "$GITHUB_STEP_SUMMARY"
echo "Created: $STAMP UTC" >> "$GITHUB_STEP_SUMMARY"
echo "PostgreSQL archive indexed successfully; Auth identities and Maya sales schema present." >> "$GITHUB_STEP_SUMMARY"
echo "Encrypted before upload with externally held age key. Maximum artifact lifetime: 3 days." >> "$GITHUB_STEP_SUMMARY"
echo "Restore was NOT tested against a full Supabase replacement. Storage object binaries are NOT included." >> "$GITHUB_STEP_SUMMARY"
