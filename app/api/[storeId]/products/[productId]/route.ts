import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs";

import prismadb from "@/lib/prismadb";
import { publicError, publicJson } from "@/lib/public-cors";
import {
  InsufficientVariantStagingError,
  reconcileProductVariants,
} from "@/lib/reconcile-product-variants";

type ImageInput = { url: string; colorId?: string | null };
type VariantInput = { id?: string; colorId: string; sizeId: string; stock: number };

function parseVariants(body: unknown): VariantInput[] | null {
  const raw = (body as Record<string, unknown>)?.variants;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: VariantInput[] = [];
  const keys = new Set<string>();
  for (const row of raw) {
    const r = row as Record<string, unknown>;
    const colorId = typeof r.colorId === "string" ? r.colorId : "";
    const sizeId = typeof r.sizeId === "string" ? r.sizeId : "";
    const stock = Math.trunc(Number(r.stock));
    const id = typeof r.id === "string" && r.id ? r.id : undefined;
    if (!colorId || !sizeId || !Number.isFinite(stock) || stock < 0) return null;
    const k = `${colorId}:${sizeId}`;
    if (keys.has(k)) return null;
    keys.add(k);
    out.push({ id, colorId, sizeId, stock });
  }
  return out;
}

function parseImages(body: unknown): ImageInput[] | null {
  const raw = (body as Record<string, unknown>)?.images;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ImageInput[] = [];
  for (const row of raw) {
    const r = row as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url : "";
    if (!url) return null;
    const colorId =
      typeof r.colorId === "string" && r.colorId ? r.colorId : (r.colorId === null ? null : undefined);
    out.push({ url, colorId: colorId ?? undefined });
  }
  return out;
}

function isSimpleInventory(body: unknown): boolean {
  return (body as Record<string, unknown>).simpleInventory === true;
}

function parseProductLevelStock(body: unknown): number | null {
  const n = Math.trunc(Number((body as Record<string, unknown>).stock));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

const productInclude = {
  images: true,
  category: true,
  variants: {
    include: {
      color: true,
      size: true,
    },
  },
} as const;

export async function GET(req: Request, { params }: { params: { productId: string } }) {
  try {
    if (!params.productId) {
      return publicError("Product id is required", 400);
    }

    const product = await prismadb.product.findUnique({
      where: {
        id: params.productId,
      },
      include: productInclude,
    });

    return publicJson(product);
  } catch (error) {
    console.log("[PRODUCT_GET]", error);
    return publicError("Internal error", 500);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { productId: string; storeId: string } }
) {
  try {
    const { userId } = auth();

    if (!userId) {
      return new NextResponse("Unauthenticated", { status: 403 });
    }

    if (!params.productId) {
      return new NextResponse("Product id is required", { status: 400 });
    }

    const storeByUserId = await prismadb.store.findFirst({
      where: {
        id: params.storeId,
        userId,
      },
    });

    if (!storeByUserId) {
      return new NextResponse("Unauthorized", { status: 405 });
    }

    const product = await prismadb.product.delete({
      where: {
        id: params.productId,
      },
    });

    return NextResponse.json(product);
  } catch (error) {
    console.log("[PRODUCT_DELETE]", error);
    return new NextResponse("Internal error", { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { productId: string; storeId: string } }
) {
  try {
    const { userId } = auth();

    const body = await req.json();

    const {
      name,
      price,
      categoryId,
      images: _images,
      isFeatured,
      isBillboard,
      isArchived,
      description,
      width,
      height,
      depth,
    } = body;

    if (!userId) {
      return new NextResponse("Unauthenticated", { status: 403 });
    }

    if (!params.productId) {
      return new NextResponse("Product id is required", { status: 400 });
    }

    if (!name) {
      return new NextResponse("Name is required", { status: 400 });
    }

    const images = parseImages(body);
    if (!images) {
      return new NextResponse("Images are required", { status: 400 });
    }

    if (!price) {
      return new NextResponse("Price is required", { status: 400 });
    }

    if (!categoryId) {
      return new NextResponse("Category id is required", { status: 400 });
    }

    const storeByUserId = await prismadb.store.findFirst({
      where: {
        id: params.storeId,
        userId,
      },
    });

    if (!storeByUserId) {
      return new NextResponse("Unauthorized", { status: 405 });
    }

    const simple = isSimpleInventory(body);
    const txOpts = {
      maxWait: 10_000,
      timeout: 30_000,
    };

    if (simple) {
      const stock = parseProductLevelStock(body);
      if (stock === null) {
        return new NextResponse("Valid stock is required for products without variants", { status: 400 });
      }

      await prismadb.$transaction(
        async (tx) => {
          await tx.productVariant.deleteMany({
            where: { productId: params.productId },
          });

          await tx.product.update({
            where: { id: params.productId },
            data: {
              name,
              description: typeof description === "string" ? description : "",
              width: width != null && width !== "" ? Number(width) : null,
              height: height != null && height !== "" ? Number(height) : null,
              depth: depth != null && depth !== "" ? Number(depth) : null,
              price,
              categoryId,
              stock,
              images: { deleteMany: {} },
              isFeatured: isFeatured ?? false,
              isBillboard: isBillboard ?? false,
              isArchived: isArchived ?? false,
            },
          });

          await tx.image.createMany({
            data: images.map((img) => ({
              productId: params.productId,
              url: img.url,
              colorId: img.colorId ?? null,
            })),
          });
        },
        txOpts
      );
    } else {
      const variants = parseVariants(body);
      if (!variants) {
        return new NextResponse("At least one valid variant (colorId, sizeId, stock) is required", { status: 400 });
      }

      await prismadb.$transaction(
        async (tx) => {
          await reconcileProductVariants(tx, params.storeId, params.productId, variants);

          await tx.product.update({
            where: { id: params.productId },
            data: {
              name,
              description: typeof description === "string" ? description : "",
              width: width != null && width !== "" ? Number(width) : null,
              height: height != null && height !== "" ? Number(height) : null,
              depth: depth != null && depth !== "" ? Number(depth) : null,
              price,
              categoryId,
              stock: 0,
              images: { deleteMany: {} },
              isFeatured: isFeatured ?? false,
              isBillboard: isBillboard ?? false,
              isArchived: isArchived ?? false,
            },
          });

          await tx.image.createMany({
            data: images.map((img) => ({
              productId: params.productId,
              url: img.url,
              colorId: img.colorId ?? null,
            })),
          });
        },
        txOpts
      );
    }

    const product = await prismadb.product.findUniqueOrThrow({
      where: { id: params.productId },
      include: productInclude,
    });

    return NextResponse.json(product);
  } catch (error) {
    if (error instanceof InsufficientVariantStagingError) {
      return new NextResponse(
        "Cannot rearrange variants: add more colors or sizes in the store, or reduce how many variant rows you change at once.",
        { status: 409 }
      );
    }
    console.log("[PRODUCT_PATCH]", error);
    return new NextResponse("Internal error", { status: 500 });
  }
}
