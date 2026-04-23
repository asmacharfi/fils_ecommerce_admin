import { OrderFulfillmentStatus } from "@prisma/client";
import { auth } from "@clerk/nextjs";
import { NextResponse } from "next/server";

import prismadb from "@/lib/prismadb";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

const ALLOWED_STATUS: OrderFulfillmentStatus[] = ["PROCESSING", "SHIPPED", "DELIVERED"];

export async function PATCH(
  req: Request,
  { params }: { params: { storeId: string; orderId: string } }
) {
  try {
    const { userId } = auth();
    if (!userId) {
      return new NextResponse("Unauthenticated", { status: 401, headers: corsHeaders });
    }

    if (!params.storeId || !params.orderId) {
      return new NextResponse("storeId and orderId are required", { status: 400, headers: corsHeaders });
    }

    const store = await prismadb.store.findFirst({
      where: { id: params.storeId, userId },
    });
    if (!store) {
      return new NextResponse("Unauthorized", { status: 403, headers: corsHeaders });
    }

    const order = await prismadb.order.findFirst({
      where: { id: params.orderId, storeId: params.storeId },
    });
    if (!order) {
      return new NextResponse("Not found", { status: 404, headers: corsHeaders });
    }

    if (!order.isPaid) {
      return new NextResponse("Fulfillment can only be updated for paid orders", {
        status: 400,
        headers: corsHeaders,
      });
    }

    const body = (await req.json().catch(() => ({}))) as {
      fulfillmentStatus?: string;
      trackingNumber?: string;
    };

    const nextStatus =
      typeof body.fulfillmentStatus === "string"
        ? (body.fulfillmentStatus.toUpperCase() as OrderFulfillmentStatus)
        : null;

    if (nextStatus && !ALLOWED_STATUS.includes(nextStatus)) {
      return new NextResponse("Invalid fulfillmentStatus", { status: 400, headers: corsHeaders });
    }

    const trackingNumber =
      typeof body.trackingNumber === "string" ? body.trackingNumber.trim().slice(0, 120) : undefined;

    const updated = await prismadb.order.update({
      where: { id: order.id },
      data: {
        ...(nextStatus ? { fulfillmentStatus: nextStatus } : {}),
        ...(trackingNumber !== undefined ? { trackingNumber } : {}),
      },
    });

    return NextResponse.json(
      {
        id: updated.id,
        fulfillmentStatus: updated.fulfillmentStatus,
        trackingNumber: updated.trackingNumber,
      },
      { headers: corsHeaders }
    );
  } catch (e) {
    console.error("[ORDER_PATCH]", e);
    return new NextResponse("Internal error", { status: 500, headers: corsHeaders });
  }
}
