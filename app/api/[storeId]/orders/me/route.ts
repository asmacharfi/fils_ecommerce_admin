import { NextResponse } from "next/server";

import prismadb from "@/lib/prismadb";
import { fulfillmentLabel } from "@/lib/recommendations/personalized-for-shopper";
import { publicCorsHeaders, publicError, publicJson } from "@/lib/public-cors";
import { verifyStorefrontBearer } from "@/lib/verify-storefront-bearer";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: publicCorsHeaders });
}

export async function GET(req: Request, { params }: { params: { storeId: string } }) {
  try {
    if (!params.storeId) {
      return publicError("Store id is required", 400);
    }

    const userId = await verifyStorefrontBearer(req);
    if (!userId) {
      return publicError("Unauthorized", 401);
    }

    const orders = await prismadb.order.findMany({
      where: {
        storeId: params.storeId,
        clerkUserId: userId,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        isPaid: true,
        fulfillmentStatus: true,
        trackingNumber: true,
        address: true,
        phone: true,
        customerEmail: true,
        orderItems: {
          select: {
            quantity: true,
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                images: {
                  take: 1,
                  orderBy: { createdAt: "asc" },
                  select: { url: true },
                },
              },
            },
          },
        },
      },
    });

    const payload = orders.map((o) => {
      const total = o.orderItems.reduce(
        (sum, oi) => sum + Number(oi.product.price) * oi.quantity,
        0
      );
      return {
        id: o.id,
        createdAt: o.createdAt.toISOString(),
        isPaid: o.isPaid,
        fulfillmentStatus: o.fulfillmentStatus,
        statusLabel: fulfillmentLabel(o.isPaid, o.fulfillmentStatus),
        trackingNumber: o.trackingNumber || null,
        address: o.address,
        phone: o.phone,
        customerEmail: o.customerEmail || null,
        total,
        items: o.orderItems.map((oi) => ({
          quantity: oi.quantity,
          productId: oi.product.id,
          name: oi.product.name,
          unitPrice: Number(oi.product.price),
          imageUrl: oi.product.images[0]?.url ?? null,
        })),
      };
    });

    return publicJson(payload);
  } catch (e) {
    console.error("[ORDERS_ME_GET]", e);
    return publicError("Internal error", 500);
  }
}
