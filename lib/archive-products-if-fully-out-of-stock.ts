import type { Prisma } from "@prisma/client";

/**
 * Sets isArchived only when inventory is fully depleted after checkout payment.
 * Simple products (no variant rows): archive when product.stock <= 0.
 * Variant products: archive when every variant has stock <= 0.
 * Does not un-archive (restock / manual stays explicit).
 */
export async function archiveProductsIfFullyOutOfStock(
  tx: Prisma.TransactionClient,
  productIds: string[]
): Promise<void> {
  const uniqueIds = Array.from(new Set(productIds));
  for (const productId of uniqueIds) {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        stock: true,
        variants: { select: { stock: true } },
      },
    });
    if (!product) continue;

    const hasVariants = product.variants.length > 0;
    const fullyOutOfStock = hasVariants
      ? product.variants.every((v) => v.stock <= 0)
      : product.stock <= 0;

    if (fullyOutOfStock) {
      await tx.product.update({
        where: { id: product.id },
        data: { isArchived: true },
      });
    }
  }
}
