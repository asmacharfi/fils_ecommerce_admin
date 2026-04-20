import type { PrismaClient } from "@prisma/client";

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export type VariantPatchRow = {
  id?: string;
  colorId: string;
  sizeId: string;
  stock: number;
};

function pairKey(colorId: string, sizeId: string): string {
  return `${colorId}:${sizeId}`;
}

export class InsufficientVariantStagingError extends Error {
  constructor() {
    super("INSUFFICIENT_STAGING_VARIANT_SLOTS");
    this.name = "InsufficientVariantStagingError";
  }
}

/**
 * Applies variant creates/updates without tripping @@unique([productId, colorId, sizeId])
 * when admins swap color/size between existing rows (would fail with naive sequential updates).
 */
export async function reconcileProductVariants(
  tx: Tx,
  storeId: string,
  productId: string,
  variants: VariantPatchRow[]
): Promise<void> {
  const incomingIds = variants.filter((v) => v.id).map((v) => v.id as string);

  if (incomingIds.length > 0) {
    await tx.productVariant.deleteMany({
      where: {
        productId,
        id: { notIn: incomingIds },
      },
    });
  } else {
    await tx.productVariant.deleteMany({ where: { productId } });
  }

  const existing = await tx.productVariant.findMany({ where: { productId } });
  const existingById = new Map(existing.map((e) => [e.id, e]));

  const withId = variants.filter((v): v is VariantPatchRow & { id: string } => Boolean(v.id));
  const toCreate = variants.filter((v) => !v.id);

  const finalKeys = new Set(variants.map((v) => pairKey(v.colorId, v.sizeId)));

  const occupied = new Set(existing.map((e) => pairKey(e.colorId, e.sizeId)));

  const stockOnly = withId.filter((v) => {
    const cur = existingById.get(v.id);
    return cur && cur.colorId === v.colorId && cur.sizeId === v.sizeId;
  });

  const shapeChanges = withId.filter((v) => {
    const cur = existingById.get(v.id);
    return cur && (cur.colorId !== v.colorId || cur.sizeId !== v.sizeId);
  });

  for (const v of stockOnly) {
    await tx.productVariant.update({
      where: { id: v.id, productId },
      data: { stock: v.stock },
    });
  }

  if (shapeChanges.length > 0) {
    const [colors, sizes] = await Promise.all([
      tx.color.findMany({ where: { storeId }, select: { id: true } }),
      tx.size.findMany({ where: { storeId }, select: { id: true } }),
    ]);

    const stagingPool: { colorId: string; sizeId: string }[] = [];
    for (const c of colors) {
      for (const s of sizes) {
        const k = pairKey(c.id, s.id);
        if (finalKeys.has(k)) continue;
        if (occupied.has(k)) continue;
        stagingPool.push({ colorId: c.id, sizeId: s.id });
      }
    }

    if (stagingPool.length < shapeChanges.length) {
      throw new InsufficientVariantStagingError();
    }

    for (let i = 0; i < shapeChanges.length; i++) {
      const v = shapeChanges[i]!;
      const st = stagingPool[i]!;
      const cur = existingById.get(v.id)!;
      occupied.delete(pairKey(cur.colorId, cur.sizeId));
      occupied.add(pairKey(st.colorId, st.sizeId));
      await tx.productVariant.update({
        where: { id: v.id, productId },
        data: { colorId: st.colorId, sizeId: st.sizeId },
      });
    }

    for (const v of shapeChanges) {
      await tx.productVariant.update({
        where: { id: v.id, productId },
        data: {
          colorId: v.colorId,
          sizeId: v.sizeId,
          stock: v.stock,
        },
      });
    }
  }

  for (const v of toCreate) {
    await tx.productVariant.create({
      data: {
        productId,
        colorId: v.colorId,
        sizeId: v.sizeId,
        stock: v.stock,
      },
    });
  }
}
