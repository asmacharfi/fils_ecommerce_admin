import { PrismaClient } from "@prisma/client";

/**
 * Cap Prisma's pool size so small hosted Postgres plans (e.g. Aiven free/hobby)
 * do not hit "remaining connection slots are reserved for ... SUPERUSER" (P2037).
 * Honors an explicit `connection_limit` on DATABASE_URL when present.
 */
function prismaDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
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
