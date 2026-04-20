import { NextResponse } from "next/server";

import prismadb from "@/lib/prismadb";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type VariantLine = { kind: "variant"; variantId: string; quantity: number };
type ProductLine = { kind: "product"; productId: string; quantity: number };
type Line = VariantLine | ProductLine;

function parseLines(rawItems: unknown): Line[] | null {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return null;
  const merged = new Map<string, Line>();
  for (const row of rawItems) {
    const r = row as Record<string, unknown>;
    const q = Math.trunc(Number(r.quantity));
    const variantId = typeof r.variantId === "string" && r.variantId ? r.variantId : "";
    const productId = typeof r.productId === "string" && r.productId ? r.productId : "";
    if (!Number.isFinite(q) || q < 1) return null;
    if (variantId && productId) return null;
    if (!variantId && !productId) return null;
    if (variantId) {
      const key = `v:${variantId}`;
      const prev = merged.get(key) as VariantLine | undefined;
      merged.set(key, {
        kind: "variant",
        variantId,
        quantity: (prev?.quantity ?? 0) + q,
      });
    } else {
      const key = `p:${productId}`;
      const prev = merged.get(key) as ProductLine | undefined;
      merged.set(key, {
        kind: "product",
        productId,
        quantity: (prev?.quantity ?? 0) + q,
      });
    }
  }
  return Array.from(merged.values());
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * Public stock check for storefront (same store scope as catalog GET).
 * Does not mutate inventory.
 */
export async function POST(req: Request, { params }: { params: { storeId: string } }) {
  try {
    const body = await req.json();
    const rawItems = body.items as unknown;
    const lines = parseLines(rawItems);

    if (!params.storeId) {
      return new NextResponse("Store id is required", { status: 400, headers: corsHeaders });
    }

    if (!lines?.length) {
      return new NextResponse("items array is required", { status: 400, headers: corsHeaders });
    }

    const store = await prismadb.store.findFirst({
      where: { id: params.storeId },
    });
    if (!store) {
      return new NextResponse("Store not found", { status: 404, headers: corsHeaders });
    }

    const variantLines = lines.filter((l): l is VariantLine => l.kind === "variant");
    const productLines = lines.filter((l): l is ProductLine => l.kind === "product");

    const variantIds = variantLines.map((l) => l.variantId);
    const variants = await prismadb.productVariant.findMany({
      where: {
        id: { in: variantIds },
        product: {
          storeId: params.storeId,
          isArchived: false,
        },
      },
      include: { product: { select: { id: true } } },
    });

    if (variantIds.length && variants.length !== new Set(variantIds).size) {
      return NextResponse.json(
        { ok: false, errors: [{ variantId: "", message: "One or more variants were not found." }] },
        { status: 400, headers: corsHeaders }
      );
    }

    const productIds = productLines.map((l) => l.productId);
    const simpleProducts =
      productIds.length > 0
        ? await prismadb.product.findMany({
            where: {
              id: { in: productIds },
              storeId: params.storeId,
              isArchived: false,
              variants: { none: {} },
            },
            select: { id: true, stock: true },
          })
        : [];

    if (productIds.length && simpleProducts.length !== new Set(productIds).size) {
      return NextResponse.json(
        {
          ok: false,
          errors: [{ productId: "", message: "One or more products were not found or use variants." }],
        },
        { status: 400, headers: corsHeaders }
      );
    }

    const errors: { variantId?: string; productId?: string; message: string }[] = [];

    const wantByVariant = new Map(variantLines.map((l) => [l.variantId, l.quantity]));
    for (const v of variants) {
      const want = wantByVariant.get(v.id) ?? 0;
      if (want > v.stock) {
        errors.push({
          variantId: v.id,
          message: `Requested ${want} but only ${v.stock} in stock.`,
        });
      }
    }

    const byProductId = new Map(simpleProducts.map((p) => [p.id, p]));
    for (const line of productLines) {
      const p = byProductId.get(line.productId);
      const want = line.quantity;
      if (!p || want > p.stock) {
        errors.push({
          productId: line.productId,
          message: p
            ? `Requested ${want} but only ${p.stock} in stock.`
            : "Product not found or has variants — use variantId in the cart.",
        });
      }
    }

    if (errors.length) {
      return NextResponse.json({ ok: false, errors }, { status: 400, headers: corsHeaders });
    }

    return NextResponse.json({ ok: true }, { headers: corsHeaders });
  } catch (error) {
    console.log("[VALIDATE_STOCK_POST]", error);
    return new NextResponse("Internal error", { status: 500, headers: corsHeaders });
  }
}
