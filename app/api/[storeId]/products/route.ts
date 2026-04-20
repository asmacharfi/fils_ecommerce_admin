import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs";

import prismadb from "@/lib/prismadb";

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

export async function POST(req: Request, { params }: { params: { storeId: string } }) {
  try {
    const { userId } = auth();

    const body = await req.json();

    const {
      name,
      price,
      categoryId,
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

    if (!params.storeId) {
      return new NextResponse("Store id is required", { status: 400 });
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

    if (simple) {
      const stock = parseProductLevelStock(body);
      if (stock === null) {
        return new NextResponse("Valid stock is required for products without variants", { status: 400 });
      }

      const product = await prismadb.product.create({
        data: {
          name,
          description: typeof description === "string" ? description : "",
          width: width != null && width !== "" ? Number(width) : null,
          height: height != null && height !== "" ? Number(height) : null,
          depth: depth != null && depth !== "" ? Number(depth) : null,
          price,
          stock,
          isFeatured: isFeatured ?? false,
          isBillboard: isBillboard ?? false,
          isArchived: isArchived ?? false,
          categoryId,
          storeId: params.storeId,
          images: {
            createMany: {
              data: images.map((img) => ({
                url: img.url,
                colorId: img.colorId ?? null,
              })),
            },
          },
        },
        include: {
          images: true,
          category: true,
          variants: { include: { color: true, size: true } },
        },
      });

      return NextResponse.json(product);
    }

    const variants = parseVariants(body);
    if (!variants) {
      return new NextResponse("At least one valid variant (colorId, sizeId, stock) is required", { status: 400 });
    }

    const product = await prismadb.product.create({
      data: {
        name,
        description: typeof description === "string" ? description : "",
        width: width != null && width !== "" ? Number(width) : null,
        height: height != null && height !== "" ? Number(height) : null,
        depth: depth != null && depth !== "" ? Number(depth) : null,
        price,
        stock: 0,
        isFeatured: isFeatured ?? false,
        isBillboard: isBillboard ?? false,
        isArchived: isArchived ?? false,
        categoryId,
        storeId: params.storeId,
        images: {
          createMany: {
            data: images.map((img) => ({
              url: img.url,
              colorId: img.colorId ?? null,
            })),
          },
        },
        variants: {
          createMany: {
            data: variants.map((v) => ({
              colorId: v.colorId,
              sizeId: v.sizeId,
              stock: v.stock,
            })),
          },
        },
      },
      include: {
        images: true,
        category: true,
        variants: { include: { color: true, size: true } },
      },
    });

    return NextResponse.json(product);
  } catch (error) {
    console.log("[PRODUCTS_POST]", error);
    return new NextResponse("Internal error", { status: 500 });
  }
}

export async function GET(req: Request, { params }: { params: { storeId: string } }) {
  try {
    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get("categoryId") || undefined;
    const colorId = searchParams.get("colorId") || undefined;
    const sizeId = searchParams.get("sizeId") || undefined;
    const isFeatured = searchParams.get("isFeatured");
    const isBillboard = searchParams.get("isBillboard");

    if (!params.storeId) {
      return new NextResponse("Store id is required", { status: 400 });
    }

    const products = await prismadb.product.findMany({
      where: {
        storeId: params.storeId,
        categoryId,
        isFeatured: isFeatured === "true" ? true : undefined,
        isBillboard: isBillboard === "true" ? true : undefined,
        isArchived: false,
        ...(colorId || sizeId
          ? {
              variants: {
                some: {
                  ...(colorId ? { colorId } : {}),
                  ...(sizeId ? { sizeId } : {}),
                },
              },
            }
          : {}),
      },
      include: {
        images: true,
        category: true,
        variants: {
          include: {
            color: true,
            size: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(products);
  } catch (error) {
    console.log("[PRODUCTS_GET]", error);
    return new NextResponse("Internal error", { status: 500 });
  }
}
