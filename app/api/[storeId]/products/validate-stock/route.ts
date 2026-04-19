import { NextResponse } from "next/server";

import prismadb from "@/lib/prismadb";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type Line = { productId: string; quantity: number };

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
    const rawItems = body.items as Line[] | undefined;

    if (!params.storeId) {
      return new NextResponse("Store id is required", { status: 400, headers: corsHeaders });
    }

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return new NextResponse("items array is required", { status: 400, headers: corsHeaders });
    }

    const store = await prismadb.store.findFirst({
      where: { id: params.storeId },
    });
    if (!store) {
      return new NextResponse("Store not found", { status: 404, headers: corsHeaders });
    }

    const merged = new Map<string, number>();
    for (const row of rawItems) {
      const id = row?.productId;
      const q = Math.trunc(Number(row?.quantity));
      if (!id || !Number.isFinite(q) || q < 1) {
        return new NextResponse("Invalid line item", { status: 400, headers: corsHeaders });
      }
      merged.set(id, (merged.get(id) ?? 0) + q);
    }

    const productIds = Array.from(merged.keys());
    const products = await prismadb.product.findMany({
      where: {
        id: { in: productIds },
        storeId: params.storeId,
        isArchived: false,
      },
    });

    if (products.length !== productIds.length) {
      return NextResponse.json(
        { ok: false, errors: [{ productId: "", message: "One or more products were not found." }] },
        { status: 400, headers: corsHeaders }
      );
    }

    const errors: { productId: string; message: string }[] = [];
    for (const p of products) {
      const want = merged.get(p.id) ?? 0;
      if (want > p.stock) {
        errors.push({
          productId: p.id,
          message: `Requested ${want} but only ${p.stock} in stock.`,
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
