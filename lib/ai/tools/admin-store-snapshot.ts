import { tool } from "ai";
import { z } from "zod";

import prismadb from "@/lib/prismadb";

const inputSchema = z.object({});

export type AdminStoreSnapshotOutput = {
  storeName: string;
  activeProductCount: number;
  archivedProductCount: number;
  orderCount: number;
  unpaidOrderCount: number;
  message: string;
};

export function createAdminStoreSnapshotTool(storeId: string) {
  return tool({
    description:
      "Get a quick read-only snapshot of this store: product counts, order counts, and unpaid orders. Use for high-level dashboard questions.",
    inputSchema: inputSchema,
    execute: async (): Promise<AdminStoreSnapshotOutput> => {
      const store = await prismadb.store.findFirst({
        where: { id: storeId },
        select: { name: true },
      });

      const [
        activeProductCount,
        archivedProductCount,
        orderCount,
        unpaidOrderCount,
      ] = await Promise.all([
        prismadb.product.count({ where: { storeId, isArchived: false } }),
        prismadb.product.count({ where: { storeId, isArchived: true } }),
        prismadb.order.count({ where: { storeId } }),
        prismadb.order.count({ where: { storeId, isPaid: false } }),
      ]);

      return {
        storeName: store?.name ?? "Unknown store",
        activeProductCount,
        archivedProductCount,
        orderCount,
        unpaidOrderCount,
        message: "Store snapshot loaded.",
      };
    },
  });
}
