import { tool } from "ai";
import { z } from "zod";

import prismadb from "@/lib/prismadb";

const inputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe("Case-insensitive match on product name."),
  categoryId: z.string().optional(),
  includeArchived: z.boolean().optional().default(false),
  featuredOnly: z.boolean().optional().default(false),
  limit: z.number().min(1).max(25).optional().default(12),
});

export type AdminSearchProductsInput = z.infer<typeof inputSchema>;

export type AdminProductSummary = {
  id: string;
  name: string;
  price: string;
  categoryName: string;
  variantCount: number;
  totalStock: number;
  isFeatured: boolean;
  isArchived: boolean;
};

export type AdminSearchProductsOutput = {
  found: boolean;
  message: string;
  products: AdminProductSummary[];
};

export function createAdminSearchProductsTool(storeId: string) {
  return tool({
    description:
      "Search products for this store (read-only). Use for inventory questions, finding SKUs by name, or listing featured items.",
    inputSchema: inputSchema,
    execute: async (params): Promise<AdminSearchProductsOutput> => {
      const {
        query = "",
        categoryId,
        includeArchived = false,
        featuredOnly = false,
        limit = 12,
      } = params;

      const products = await prismadb.product.findMany({
        where: {
          storeId,
          categoryId: categoryId || undefined,
          isArchived: includeArchived ? undefined : false,
          isFeatured: featuredOnly ? true : undefined,
          ...(query.trim()
            ? {
                name: {
                  contains: query.trim(),
                  mode: "insensitive" as const,
                },
              }
            : {}),
        },
        take: limit,
        orderBy: { updatedAt: "desc" },
        include: {
          category: true,
          variants: true,
        },
      });

      if (!products.length) {
        return {
          found: false,
          message: "No products matched those filters.",
          products: [],
        };
      }

      const summaries: AdminProductSummary[] = products.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price.toString(),
        categoryName: p.category.name,
        variantCount: p.variants.length,
        totalStock:
          p.variants.length > 0 ? p.variants.reduce((s, v) => s + v.stock, 0) : p.stock,
        isFeatured: p.isFeatured,
        isArchived: p.isArchived,
      }));

      return {
        found: true,
        message: `Found ${summaries.length} product(s).`,
        products: summaries,
      };
    },
  });
}
