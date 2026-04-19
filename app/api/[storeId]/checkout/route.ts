import Stripe from "stripe";
import { NextResponse } from "next/server";

import { stripe } from "@/lib/stripe";
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

export async function POST(req: Request, { params }: { params: { storeId: string } }) {
  const body = await req.json();
  const rawItems = body.items as Line[] | undefined;
  const legacyIds = body.productIds as string[] | undefined;

  let lines: Line[] = [];

  if (Array.isArray(rawItems) && rawItems.length > 0) {
    const merged = new Map<string, number>();
    for (const row of rawItems) {
      const id = row?.productId;
      const q = Math.trunc(Number(row?.quantity));
      if (!id || !Number.isFinite(q) || q < 1) {
        return new NextResponse("Invalid line item", { status: 400 });
      }
      merged.set(id, (merged.get(id) ?? 0) + q);
    }
    lines = Array.from(merged.entries()).map(([productId, quantity]) => ({ productId, quantity }));
  } else if (Array.isArray(legacyIds) && legacyIds.length > 0) {
    lines = legacyIds.map((productId) => ({ productId, quantity: 1 }));
  } else {
    return new NextResponse("items or productIds are required", { status: 400 });
  }

  const productIds = lines.map((l) => l.productId);

  const products = await prismadb.product.findMany({
    where: {
      id: { in: productIds },
      storeId: params.storeId,
      isArchived: false,
    },
  });

  if (products.length !== new Set(productIds).size) {
    return new NextResponse("Invalid or missing products for this store", { status: 400 });
  }

  const byId = new Map(products.map((p) => [p.id, p]));

  for (const line of lines) {
    const p = byId.get(line.productId);
    if (!p || line.quantity > p.stock) {
      return new NextResponse("Insufficient stock for one or more items", { status: 400 });
    }
  }

  try {
    const orderId = await prismadb.$transaction(async (tx) => {
      for (const line of lines) {
        const result = await tx.product.updateMany({
          where: {
            id: line.productId,
            storeId: params.storeId,
            stock: { gte: line.quantity },
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
          orderItems: {
            create: lines.map((line) => ({
              quantity: line.quantity,
              product: { connect: { id: line.productId } },
            })),
          },
        },
      });

      return order.id;
    });

    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = lines.map((line) => {
      const product = byId.get(line.productId)!;
      return {
        quantity: line.quantity,
        price_data: {
          currency: "USD",
          product_data: {
            name: product.name,
          },
          unit_amount: product.price.toNumber() * 100,
        },
      };
    });

    const session = await stripe.checkout.sessions.create({
      line_items,
      mode: "payment",
      billing_address_collection: "required",
      phone_number_collection: {
        enabled: true,
      },
      success_url: `${process.env.FRONTEND_STORE_URL}/cart?success=1`,
      cancel_url: `${process.env.FRONTEND_STORE_URL}/cart?canceled=1`,
      metadata: {
        orderId,
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
      });
    }
    console.log("[CHECKOUT_POST]", e);
    return new NextResponse("Internal error", { status: 500 });
  }
}
