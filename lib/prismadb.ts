import { PrismaClient } from "@prisma/client";

function stripEnvQuotes(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let s = value.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s || undefined;
}

/**
 * Runtime URL for the Prisma client (serverless-friendly).
 * Prefer pooled URLs when present (Vercel Postgres, Neon, etc.) so many
 * concurrent lambdas do not exhaust direct Postgres connection slots (P2037).
 */
function pickRawDatabaseUrl(): string | undefined {
  return (
    stripEnvQuotes(process.env.POSTGRES_PRISMA_URL) ||
    stripEnvQuotes(process.env.PRISMA_DATABASE_URL) ||
    stripEnvQuotes(process.env.POSTGRES_URL) ||
    stripEnvQuotes(process.env.DATABASE_URL)
  );
}

/**
 * Neon direct endpoints look like `ep-….region.aws.neon.tech`; pooled adds `-pooler`
 * on the first label. If someone pastes the direct string into Vercel, rewrite it
 * so Prisma hits PgBouncer instead of opening many direct compute connections.
 */
function neonDirectToPoolerUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (!/\.aws\.neon\.tech$/i.test(host)) return raw;
    const labels = host.split(".");
    const first = labels[0] ?? "";
    if (!first.startsWith("ep-") || first.endsWith("-pooler")) return raw;
    labels[0] = `${first}-pooler`;
    u.hostname = labels.join(".");
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Aiven PgBouncer pool URIs reuse the same hostname as the primary service but use a
 * different port; the path’s database segment is the *pool name* (not `defaultdb`).
 * Prisma needs `pgbouncer=true` for transaction-mode PgBouncer.
 * @see https://aiven.io/docs/products/postgresql/howto/manage-pool
 */
function aivenUsesConnectionPoolPath(u: URL): boolean {
  const h = u.hostname.toLowerCase();
  if (!h.endsWith(".aivencloud.com")) return false;
  const pathDb = (u.pathname.replace(/^\//, "").split("/")[0] ?? "").trim();
  if (!pathDb) return false;
  return pathDb.toLowerCase() !== "defaultdb";
}

/**
 * PgBouncer (transaction mode) needs `pgbouncer=true` so Prisma disables prepared
 * statements that PgBouncer cannot pin to one server session.
 */
function ensurePgbouncerParamForPoolerHosts(u: URL): void {
  const h = u.hostname.toLowerCase();
  const pooledHost =
    h.includes("pooler") ||
    /\.pooler\.supabase\.com$/i.test(h) ||
    (/\.aws\.neon\.tech$/i.test(h) && h.split(".")[0]?.endsWith("-pooler"));
  if (!pooledHost && !aivenUsesConnectionPoolPath(u)) return;
  if (!u.searchParams.has("pgbouncer")) {
    u.searchParams.set("pgbouncer", "true");
  }
}

/**
 * Cap Prisma pool size so small hosted Postgres plans do not hit P2037
 * ("remaining connection slots are reserved for … SUPERUSER").
 * Honors an explicit `connection_limit` on the URL when present.
 */
function prismaDatabaseUrl(): string | undefined {
  let raw = pickRawDatabaseUrl();
  if (!raw) return undefined;
  raw = neonDirectToPoolerUrl(raw);
  try {
    const u = new URL(raw);
    if (/\.aws\.neon\.tech$/i.test(u.hostname) && !u.searchParams.has("connect_timeout")) {
      u.searchParams.set("connect_timeout", "15");
    }
    if (u.hostname.toLowerCase().endsWith(".aivencloud.com") && !u.searchParams.has("sslmode")) {
      u.searchParams.set("sslmode", "require");
    }
    ensurePgbouncerParamForPoolerHosts(u);
    if (!u.searchParams.has("connection_limit")) {
      const limit = process.env.DATABASE_CONNECTION_LIMIT ?? "1";
      u.searchParams.set("connection_limit", limit);
    }
    if (!u.searchParams.has("pool_timeout")) {
      u.searchParams.set("pool_timeout", "20");
    }
    return u.toString();
  } catch {
    return raw;
  }
}

const globalForPrisma = globalThis as unknown as {
  prismadb: PrismaClient | undefined;
};

function createClient() {
  const url = prismaDatabaseUrl();
  return new PrismaClient({
    ...(url
      ? {
          datasources: {
            db: { url },
          },
        }
      : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

const prismadb =
  globalForPrisma.prismadb ??
  (globalForPrisma.prismadb = createClient());

export default prismadb;
