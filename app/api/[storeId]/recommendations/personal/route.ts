import { NextResponse } from "next/server";

import { getPersonalizedProducts } from "@/lib/recommendations/personalized-for-shopper";
import { publicCorsHeaders, publicError, publicJson } from "@/lib/public-cors";
import { parseOptionalUuid, verifyStorefrontBearer } from "@/lib/verify-storefront-bearer";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: publicCorsHeaders });
}

export async function GET(req: Request, { params }: { params: { storeId: string } }) {
  try {
    if (!params.storeId) {
      return publicError("Store id is required", 400);
    }

    const url = new URL(req.url);
    const clerkUserId = await verifyStorefrontBearer(req);
    const shopperId = parseOptionalUuid(url.searchParams.get("shopperId"));

    const limitRaw = Math.trunc(Number(url.searchParams.get("limit")));
    const limit = Number.isFinite(limitRaw) ? limitRaw : 12;

    const cartRaw = url.searchParams.get("cartProductIds") || "";
    const cartProductIds = cartRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const products = await getPersonalizedProducts({
      storeId: params.storeId,
      shopperId,
      clerkUserId,
      cartProductIds,
      limit,
    });

    return publicJson(products);
  } catch (e) {
    console.error("[RECOMMENDATIONS_PERSONAL_GET]", e);
    return publicError("Internal error", 500);
  }
}
