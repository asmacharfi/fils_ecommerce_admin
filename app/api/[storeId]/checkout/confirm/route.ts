import { NextResponse } from "next/server";

import { stripe } from "@/lib/stripe";
import prismadb from "@/lib/prismadb";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * Marks an order paid after Stripe Checkout, using a live session lookup.
 * Use when the Stripe webhook is not wired (e.g. local dev) or arrives late.
 * Safe to call multiple times; matches webhook behavior when still unpaid.
 */
export async function POST(req: Request, { params }: { params: { storeId: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId) {
      return new NextResponse("sessionId is required", { status: 400, headers: corsHeaders });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const paid =
      session.payment_status === "paid" || session.payment_status === "no_payment_required";
    if (!paid) {
      return new NextResponse("Checkout session is not paid yet", { status: 400, headers: corsHeaders });
    }

    const orderId = session.metadata?.orderId;
    if (!orderId) {
      return new NextResponse("Missing orderId on session metadata", { status: 400, headers: corsHeaders });
    }

    const order = await prismadb.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    });

    if (!order || order.storeId !== params.storeId) {
      return new NextResponse("Order not found", { status: 404, headers: corsHeaders });
    }

    if (order.isPaid) {
      return NextResponse.json({ ok: true, alreadyPaid: true }, { headers: corsHeaders });
    }

    const address = session.customer_details?.address;
    const addressComponents = [
      address?.line1,
      address?.line2,
      address?.city,
      address?.state,
      address?.postal_code,
      address?.country,
    ];
    const addressString = addressComponents.filter((c) => c != null && c !== "").join(", ");

    await prismadb.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          isPaid: true,
          address: addressString,
          phone: session.customer_details?.phone ?? "",
        },
      });

      const productIds = order.orderItems.map((oi) => oi.productId);
      if (productIds.length) {
        await tx.product.updateMany({
          where: { id: { in: productIds } },
          data: { isArchived: true },
        });
      }
    });

    return NextResponse.json({ ok: true }, { headers: corsHeaders });
  } catch (e) {
    console.error("[CHECKOUT_CONFIRM]", e);
    return new NextResponse("Internal error", { status: 500, headers: corsHeaders });
  }
}
