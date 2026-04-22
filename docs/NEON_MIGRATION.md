# Neon migration (Aiven → Neon)

This repo previously used Aiven Postgres without a usable server-side pooler on the free tier, which caused Prisma **P2037** on Vercel. Neon provides a **PgBouncer pooler** host (`…-pooler…`) suitable for serverless.

## 1. Neon project & connection strings

1. In [Neon Console](https://console.neon.tech), open your project (e.g. **ecommerce admin**).
2. **Connect** → pick branch **production**, database **neondb**, role **neondb_owner**.
3. Copy **two** URIs (same password in both):
   - **Pooled (runtime):** turn **Connection pooling** **ON** — host ends with `-pooler` before `.c-….aws.neon.tech`.
   - **Direct (migrations / dump restore):** turn **Connection pooling** **OFF** — host is `ep-…` **without** `-pooler`.

Store these only in `.env` / Vercel — never commit them.

## 2. Data migration (`pg_dump` → `pg_restore`)

Install PostgreSQL **client** tools (includes `pg_dump` / `pg_restore` / `psql`), e.g. macOS:

```bash
brew install libpq
brew link --force libpq   # optional: put binaries on PATH
```

From `fils_ecommerce_admin`:

```bash
export SOURCE_DATABASE_URL='postgresql://…aiven…'   # current primary / service URI
export NEON_DIRECT_URL='postgresql://…@ep-….neon.tech/neondb?sslmode=require'
# optional: UUID from your storefront NEXT_PUBLIC_API_URL path segment
export STORE_ID_TO_CHECK='00000000-0000-0000-0000-000000000000'

./scripts/migrate-aiven-to-neon.sh
```

The script prints **row counts** for `Store`, `Category`, `Product`, `ProductVariant`, `Order`, `Image`, `Color`, `Size` and optionally checks your `STORE_ID_TO_CHECK`.

If `pg_restore` errors on a non-empty Neon DB, use a fresh branch or drop objects on a throwaway branch before re-running.

## 3. Prisma env layout (local + Vercel)

After data is in Neon:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | **Pooled** Neon URI for Prisma Client / `schema.prisma` `url` (matches Neon + Prisma serverless guidance). |
| `DIRECT_URL` | **Direct** Neon URI for `prisma migrate`, `db push`, `db pull`, and the restore script. |
| `POSTGRES_PRISMA_URL` | Optional: if set, `lib/prismadb.ts` prefers this over `DATABASE_URL` (same pooled string is fine). |
| `DATABASE_CONNECTION_LIMIT` | On Vercel, keep **`1`** (or unset → defaults to 1 in code) to limit connections per lambda. |

Local `.env`: set both `DATABASE_URL` (pooled or direct is OK for dev) and `DIRECT_URL` (direct). Prisma CLI needs `DIRECT_URL` when using a pooled `DATABASE_URL`.

## 4. Vercel (admin project)

In the **admin** Vercel project → Settings → Environment Variables (Production + Preview):

1. Set **`DATABASE_URL`** to the **pooled** Neon connection string.
2. Set **`DIRECT_URL`** to the **direct** Neon connection string.
3. Set **`POSTGRES_PRISMA_URL`** to the same pooled URI as `DATABASE_URL` (recommended so runtime selection stays explicit), **or** remove it if you rely on `DATABASE_URL` only.
4. Remove / replace old **Aiven** URLs.
5. Set **`DATABASE_CONNECTION_LIMIT=1`** for serverless safety.
6. Redeploy the admin app.

CLI alternative (no secrets in shell history on shared machines — prefer UI paste):

```bash
cd fils_ecommerce_admin
vercel link   # if not linked
vercel env add DIRECT_URL production
vercel env add DATABASE_URL production
```

## 5. Smoke checks (admin API)

Replace host and `storeId`:

```bash
ADMIN='https://your-admin.vercel.app'
SID='your-store-uuid'
curl -sS -o /dev/null -w "%{http_code}\n" "$ADMIN/api/$SID/categories"
curl -sS -o /dev/null -w "%{http_code}\n" "$ADMIN/api/$SID/products"
```

Expect **200** and JSON bodies with data.

## 6. Storefront

The storefront only needs:

```text
NEXT_PUBLIC_API_URL=https://<admin-host>/api/<storeId>
```

If the admin **hostname** or **store UUID** did not change, **no** storefront redeploy is required. If either changed, update Vercel env and redeploy the store ( `NEXT_PUBLIC_*` is baked at build time ).

See `fils_ecommerce_store/.env.example` for the URL shape.
