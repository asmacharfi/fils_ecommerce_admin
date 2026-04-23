import Stripe from "stripe";
import { NextResponse } from "next/server";

import { stripe } from "@/lib/stripe";
import prismadb from "@/lib/prismadb";
import { parseOptionalUuid, verifyStorefrontBearer } from "@/lib/verify-storefront-bearer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type VariantLine = { kind: "variant"; variantId: string; quantity: number };
type ProductLine = { kind: "product"; productId: string; quantity: number };
type Line = VariantLine | ProductLine;

function parseCheckoutLines(rawItems: unknown): Line[] | null {
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

export async function POST(req: Request, { params }: { params: { storeId: string } }) {
  try {
    const body = await req.json();
    const rawItems = body.items as unknown;
    const shopperId = parseOptionalUuid(body.shopperId);
    const bodyClerkRaw = typeof body.clerkUserId === "string" ? body.clerkUserId.trim() : "";

    let clerkUserId: string | null = null;
    if (bodyClerkRaw) {
      const verified = await verifyStorefrontBearer(req);
      if (!verified || verified !== bodyClerkRaw) {
        return new NextResponse("Signed-in checkout requires a valid Clerk session token.", {
          status: 403,
          headers: corsHeaders,
        });
      }
      clerkUserId = verified;
    }

    const lines = parseCheckoutLines(rawItems);

    if (!lines?.length) {
      return new NextResponse("items array with variantId or productId and quantity is required", {
        status: 400,
        headers: corsHeaders,
      });
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
      include: {
        product: true,
        color: true,
        size: true,
      },
    });

    if (variantIds.length && variants.length !== new Set(variantIds).size) {
      return new NextResponse("Invalid or missing variants for this store", {
        status: 400,
        headers: corsHeaders,
      });
    }

    const byVariantId = new Map(variants.map((v) => [v.id, v]));

    for (const line of variantLines) {
      const v = byVariantId.get(line.variantId);
      if (!v || line.quantity > v.stock) {
        return new NextResponse("Insufficient stock for one or more items", {
          status: 400,
          headers: corsHeaders,
        });
      }
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
            select: {
              id: true,
              stock: true,
              name: true,
              price: true,
            },
          })
        : [];

    if (productIds.length && simpleProducts.length !== new Set(productIds).size) {
      return new NextResponse("Invalid or missing products for this store", {
        status: 400,
        headers: corsHeaders,
      });
    }

    const byProductId = new Map(simpleProducts.map((p) => [p.id, p]));

    for (const line of productLines) {
      const p = byProductId.get(line.productId);
      if (!p || line.quantity > p.stock) {
        return new NextResponse("Insufficient stock for one or more items", {
          status: 400,
          headers: corsHeaders,
        });
      }
    }

    const orderId = await prismadb.$transaction(async (tx) => {
      for (const line of variantLines) {
        const result = await tx.productVariant.updateMany({
          where: {
            id: line.variantId,
            stock: { gte: line.quantity },
            product: { storeId: params.storeId },
          },
          data: {
            stock: { decrement: line.quantity },
          },
        });
        if (result.count !== 1) {
          throw new Error("STOCK_CONFLICT");
        }
      }

      for (const line of productLines) {
        const result = await tx.product.updateMany({
          where: {
            id: line.productId,
            storeId: params.storeId,
            stock: { gte: line.quantity },
            variants: { none: {} },
          },
          data: {
            stock: { decrement: line.quantity },
          },
        });
        if (result.count !== 1) {
          throw new Error("STOCK_CONFLICT");
        }
      }

      const order = await tx.order.create({
        data: {
          storeId: params.storeId,
          isPaid: false,
          shopperId,
          clerkUserId,
          orderItems: {
            create: [
              ...variantLines.map((line) => {
                const v = byVariantId.get(line.variantId)!;
                return {
                  quantity: line.quantity,
                  productId: v.productId,
                  variantId: v.id,
                };
              }),
              ...productLines.map((line) => ({
                quantity: line.quantity,
                productId: line.productId,
                variantId: null as string | null,
              })),
            ],
          },
        },
      });

      return order.id;
    });

    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      ...variantLines.map((line) => {
        const v = byVariantId.get(line.variantId)!;
        const name = `${v.product.name} (${v.color.name} / ${v.size.name})`;
        return {
          quantity: line.quantity,
          price_data: {
            currency: "USD",
            product_data: {
              name,
            },
            unit_amount: v.product.price.toNumber() * 100,
          },
        };
      }),
      ...productLines.map((line) => {
        const p = byProductId.get(line.productId)!;
        return {
          quantity: line.quantity,
          price_data: {
            currency: "USD",
            product_data: {
              name: p.name,
            },
            unit_amount: p.price.toNumber() * 100,
          },
        };
      }),
    ];

    const session = await stripe.checkout.sessions.create({
      line_items,
      mode: "payment",
      billing_address_collection: "required",
      phone_number_collection: {
        enabled: true,
      },
      success_url: `${process.env.FRONTEND_STORE_URL}/cart?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_STORE_URL}/cart?canceled=1`,
      metadata: {
        orderId,
        ...(shopperId ? { shopperId } : {}),
        ...(clerkUserId ? { clerkUserId } : {}),
      },
    });

    return NextResponse.json(
      { url: session.url },
      {
        headers: corsHeaders,
      }
    );
  } catch (e) {
    if (e instanceof Error && e.message === "STOCK_CONFLICT") {
      return new NextResponse("Stock changed while checking out. Please refresh and try again.", {
        status: 409,
        headers: corsHeaders,
      });
    }
    console.log("[CHECKOUT_POST]", e);
    return new NextResponse("Internal error", { status: 500, headers: corsHeaders });
  }
}
