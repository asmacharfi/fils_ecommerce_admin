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
    stripEnvQuotes(process.env.DATABASE_URL)
  );
}

/**
 * Cap Prisma's pool size so small hosted Postgres plans (e.g. Aiven free/hobby)
 * do not hit "remaining connection slots are reserved for ... SUPERUSER" (P2037).
 * Honors an explicit `connection_limit` on the URL when present.
 */
function prismaDatabaseUrl(): string | undefined {
  const raw = pickRawDatabaseUrl();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
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
