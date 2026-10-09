#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 2 ]]; then
  echo "Usage: bash scripts/verify-encrypted-maya-backup.sh /path/to/maya-backup.tar.age /private/age-key.txt" >&2
  exit 2
fi

ARCHIVE="$1"
KEY="$2"
if [[ ! -f "$ARCHIVE" || ! -f "$KEY" ]]; then
  echo "Encrypted archive and private age key must both exist." >&2
  exit 1
fi
command -v age >/dev/null || { echo "Install age encryption first." >&2; exit 1; }
command -v pg_restore >/dev/null || { echo "Install PostgreSQL 17+ client tools first." >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

age -d -i "$KEY" -o "$WORK/backup.tar" "$ARCHIVE"
tar -tf "$WORK/backup.tar" | grep -qx 'maya-postgres.dump'
tar -tf "$WORK/backup.tar" | grep -qx 'manifest.json'
tar -C "$WORK" -xf "$WORK/backup.tar" maya-postgres.dump manifest.json
pg_restore --list "$WORK/maya-postgres.dump" > "$WORK/index.txt"

node --input-type=module -e '
import fs from "node:fs"
import crypto from "node:crypto"
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
const bytes = fs.readFileSync(process.argv[2])
const actual = crypto.createHash("sha256").update(bytes).digest("hex")
if (manifest.database_project_ref !== "pgaonchvddcnlssigelt" ||
    actual !== manifest.sha256_dump || !manifest.dump_bytes ||
    manifest.dump_bytes !== bytes.length) {
  console.error("Backup identity, digest or size check failed.")
  process.exit(1)
}
console.log("Maya decrypted archive matches the backup manifest.")
console.log("Backup created:", manifest.created_at)
console.log("An actual restore into isolated Supabase is still needed for disaster recovery certification.")
' "$WORK/manifest.json" "$WORK/maya-postgres.dump"

echo "Maya backup decryption, SHA-256 and pg_restore archive listing: PASSED."
echo "No data was written to any database."
