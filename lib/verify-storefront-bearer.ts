import { verifyToken } from "@clerk/backend";

/**
 * Verifies a Clerk session JWT from the storefront (Authorization: Bearer …).
 * Uses the same `CLERK_SECRET_KEY` as the admin app when both share one Clerk application.
 */
export async function verifyStorefrontBearer(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = header.slice(7).trim();
  if (!token) return null;

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    console.error("[verifyStorefrontBearer] CLERK_SECRET_KEY is not set");
    return null;
  }

  try {
    const partiesRaw = process.env.CLERK_AUTHORIZED_PARTIES?.trim();
    const authorizedParties = partiesRaw
      ? partiesRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const payload = await verifyToken(token, {
      secretKey,
      clockSkewInMs: 120_000,
      ...(authorizedParties?.length ? { authorizedParties } : {}),
    });
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    return sub || null;
  } catch {
    return null;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseOptionalUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s || !UUID_RE.test(s)) return null;
  return s;
}
