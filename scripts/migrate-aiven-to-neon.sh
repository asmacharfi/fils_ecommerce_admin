#!/usr/bin/env bash
# Dump an existing Postgres (e.g. Aiven) and restore into Neon using a *direct*
# (non-pooler) Neon URI. Does not print connection strings.
#
# Prerequisites: `pg_dump` and `pg_restore` (PostgreSQL client tools) on PATH.
#
# Usage:
#   export SOURCE_DATABASE_URL='postgres://...aiven...'   # primary / full dump source
#   export NEON_DIRECT_URL='postgres://...@ep-....neon.tech/neondb?sslmode=require'
#   ./scripts/migrate-aiven-to-neon.sh
#
# Optional:
#   STORE_ID_TO_CHECK=<uuid>   # if set, verifies that row exists in "Store" after restore

set -euo pipefail

# Homebrew libpq is keg-only; add it if pg_dump is not on PATH.
if ! command -v pg_dump >/dev/null 2>&1; then
  for pq in /opt/homebrew/opt/libpq/bin /usr/local/opt/libpq/bin; do
    if [[ -x "$pq/pg_dump" ]]; then
      export PATH="$pq:$PATH"
      break
    fi
  done
fi

for bin in pg_dump pg_restore psql; do
  command -v "$bin" >/dev/null 2>&1 || {
    echo "error: '$bin' not found — install PostgreSQL client tools (e.g. brew install libpq)" >&2
    exit 1
  }
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Fill SOURCE / NEON from the environment, or parse optional keys from .env (no shell `source`).
eval "$(python3 <<'PY'
import re
from pathlib import Path

def get(key: str) -> str | None:
    p = Path(".env")
    if not p.exists():
        return None
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(rf"^{re.escape(key)}=(.*)$", line.strip())
        if not m:
            continue
        val = m.group(1).strip()
        if val.startswith("#"):
            return None
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        val = val.strip()
        return val or None
    return None

import os
src = os.environ.get("SOURCE_DATABASE_URL") or get("SOURCE_DATABASE_URL") or get("DATABASE_URL")
neon = os.environ.get("NEON_DIRECT_URL") or get("NEON_DIRECT_URL")
sid = os.environ.get("STORE_ID_TO_CHECK") or get("STORE_ID_TO_CHECK")
if src:
    print(f"export SOURCE_DATABASE_URL={src!r}")
if neon:
    print(f"export NEON_DIRECT_URL={neon!r}")
if sid:
    print(f"export STORE_ID_TO_CHECK={sid!r}")
PY
)"

if [[ -z "${SOURCE_DATABASE_URL:-}" ]]; then
  echo "error: set SOURCE_DATABASE_URL or DATABASE_URL in .env (see docs/NEON_MIGRATION.md)" >&2
  exit 1
fi

if [[ -z "${NEON_DIRECT_URL:-}" ]]; then
  echo "error: add NEON_DIRECT_URL to .env (Neon Connect → pooling OFF), or export it, then re-run." >&2
  exit 1
fi

DUMP="$(mktemp -t aiven_to_neon.XXXXXX.dump)"
cleanup() { rm -f "$DUMP"; }
trap cleanup EXIT

echo "==> pg_dump (custom format, no owner/ACL)…"
pg_dump "$SOURCE_DATABASE_URL" --no-owner --no-acl -Fc -f "$DUMP"

echo "==> pg_restore into Neon (direct)…"
# Empty Neon DB: plain restore. Re-run safely with --clean on a disposable branch if needed.
pg_restore \
  --verbose \
  --no-owner \
  --no-acl \
  --jobs=4 \
  -d "$NEON_DIRECT_URL" \
  "$DUMP"

echo "==> row counts (public / Prisma models)…"
psql "$NEON_DIRECT_URL" -v ON_ERROR_STOP=1 -c "
SELECT 'Store' AS tbl, COUNT(*)::bigint AS n FROM \"Store\"
UNION ALL SELECT 'Category', COUNT(*) FROM \"Category\"
UNION ALL SELECT 'Product', COUNT(*) FROM \"Product\"
UNION ALL SELECT 'ProductVariant', COUNT(*) FROM \"ProductVariant\"
UNION ALL SELECT 'Order', COUNT(*) FROM \"Order\"
UNION ALL SELECT 'Image', COUNT(*) FROM \"Image\"
UNION ALL SELECT 'Color', COUNT(*) FROM \"Color\"
UNION ALL SELECT 'Size', COUNT(*) FROM \"Size\"
ORDER BY tbl;
"

if [[ -n "${STORE_ID_TO_CHECK:-}" ]]; then
  echo "==> verifying Store id ${STORE_ID_TO_CHECK}…"
  psql "$NEON_DIRECT_URL" -v ON_ERROR_STOP=1 -c "
SELECT id, name FROM \"Store\" WHERE id = '${STORE_ID_TO_CHECK}';
"
fi

echo "Done. Next: point Vercel/runtime at Neon (see docs/NEON_MIGRATION.md)."
