import type { OrderFulfillmentStatus, Prisma } from "@prisma/client";

import prismadb from "@/lib/prismadb";

const productInclude = {
  images: true,
  category: true,
  variants: {
    include: {
      color: true,
      size: true,
    },
  },
} satisfies Prisma.ProductInclude;

export type PersonalizedProduct = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

type CoMap = Map<string, Map<string, number>>;

function addCoPair(co: CoMap, a: string, b: string) {
  if (a === b) return;
  if (!co.has(a)) co.set(a, new Map());
  if (!co.has(b)) co.set(b, new Map());
  const ma = co.get(a)!;
  const mb = co.get(b)!;
  ma.set(b, (ma.get(b) ?? 0) + 1);
  mb.set(a, (mb.get(a) ?? 0) + 1);
}

function buildCooccurrence(orderRows: { orderItems: { productId: string }[] }[]): CoMap {
  const co: CoMap = new Map();
  for (const order of orderRows) {
    const ids = Array.from(new Set(order.orderItems.map((oi) => oi.productId)));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        addCoPair(co, ids[i], ids[j]);
      }
    }
  }
  return co;
}

function coScore(co: CoMap, candidateId: string, seeds: string[]): number {
  let s = 0;
  for (const seed of seeds) {
    if (seed === candidateId) continue;
    const m = co.get(seed);
    if (m?.has(candidateId)) {
      s += (m.get(candidateId) ?? 0) * 3;
    }
  }
  return s;
}

export async function getPersonalizedProducts(params: {
  storeId: string;
  shopperId?: string | null;
  clerkUserId?: string | null;
  cartProductIds?: string[];
  limit?: number;
}): Promise<PersonalizedProduct[]> {
  const limit = Math.min(Math.max(params.limit ?? 12, 1), 24);
  const { storeId, shopperId, clerkUserId } = params;
  const cartProductIds = Array.from(new Set((params.cartProductIds ?? []).filter(Boolean)));

  const paidOrdersForProfile =
    shopperId || clerkUserId
      ? await prismadb.order.findMany({
          where: {
            storeId,
            isPaid: true,
            OR: [...(shopperId ? [{ shopperId }] : []), ...(clerkUserId ? [{ clerkUserId }] : [])],
          },
          select: {
            orderItems: { select: { productId: true, quantity: true } },
          },
        })
      : [];

  const purchasedProductIds = new Set<string>();
  const categoryWeights = new Map<string, number>();
  let priceSum = 0;
  let priceCount = 0;

  for (const order of paidOrdersForProfile) {
    for (const oi of order.orderItems) {
      purchasedProductIds.add(oi.productId);
    }
  }

  if (purchasedProductIds.size > 0) {
    const bought = await prismadb.product.findMany({
      where: { id: { in: Array.from(purchasedProductIds) }, storeId },
      select: { id: true, categoryId: true, price: true },
    });
    for (const p of bought) {
      categoryWeights.set(p.categoryId, (categoryWeights.get(p.categoryId) ?? 0) + 1);
      priceSum += p.price.toNumber();
      priceCount += 1;
    }
  }

  const avgPrice = priceCount > 0 ? priceSum / priceCount : 0;

  const allPaidOrders = await prismadb.order.findMany({
    where: { storeId, isPaid: true },
    select: { orderItems: { select: { productId: true } } },
  });
  const co = buildCooccurrence(allPaidOrders);

  const seeds = Array.from(new Set(cartProductIds.concat(Array.from(purchasedProductIds))));

  const candidates = await prismadb.product.findMany({
    where: {
      storeId,
      isArchived: false,
    },
    include: productInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const scored = candidates.map((p) => {
    let score = 0;
    const catW = categoryWeights.get(p.categoryId) ?? 0;
    if (catW > 0) {
      score += catW * 12;
    }
    if (avgPrice > 0) {
      const pn = p.price.toNumber();
      const rel = Math.abs(pn - avgPrice) / avgPrice;
      score += Math.max(0, 8 - rel * 8);
    }
    if (p.isFeatured) {
      score += 4;
    }
    if (purchasedProductIds.has(p.id)) {
      score -= 80;
    }
    score += coScore(co, p.id, seeds);
    return { p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: PersonalizedProduct[] = [];
  for (const row of scored) {
    if (row.score < -40) continue;
    if (seen.has(row.p.id)) continue;
    seen.add(row.p.id);
    out.push(row.p);
    if (out.length >= limit) break;
  }

  if (out.length < limit) {
    const featured = await prismadb.product.findMany({
      where: {
        storeId,
        isArchived: false,
        isFeatured: true,
        id: { notIn: out.map((x) => x.id) },
      },
      include: productInclude,
      take: limit - out.length,
      orderBy: { createdAt: "desc" },
    });
    for (const f of featured) {
      out.push(f);
      if (out.length >= limit) break;
    }
  }

  return out.slice(0, limit);
}

/** Serialize fulfillment for API / UI */
export function fulfillmentLabel(isPaid: boolean, status: OrderFulfillmentStatus): string {
  if (!isPaid) return "awaiting_payment";
  if (status === "SHIPPED") return "shipped";
  if (status === "DELIVERED") return "delivered";
  return "processing";
}
