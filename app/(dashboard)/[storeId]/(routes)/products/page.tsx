import { format } from "date-fns";

import prismadb from "@/lib/prismadb";
import { formatter } from "@/lib/utils";

import { ProductsClient } from "./components/client";
import { ProductColumn } from "./components/columns";

const ProductsPage = async ({
  params,
}: {
  params: { storeId: string };
}) => {
  const products = await prismadb.product.findMany({
    where: {
      storeId: params.storeId,
    },
    select: {
      id: true,
      name: true,
      isFeatured: true,
      isArchived: true,
      price: true,
      createdAt: true,
      category: {
        select: {
          name: true,
        },
      },
      variants: {
        select: {
          stock: true,
          color: {
            select: {
              name: true,
              value: true,
            },
          },
          size: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const formattedProducts: ProductColumn[] = products.map((item) => {
    const stock = item.variants.reduce((sum, v) => sum + v.stock, 0);
    const first = item.variants[0];
    const sizeLabel =
      item.variants.length <= 1 ? (first?.size.name ?? "—") : `${new Set(item.variants.map((v) => v.size.name)).size} sizes`;
    const colorSwatch = first?.color.value ?? "#ccc";
    const colorName = first?.color.name ?? "—";

    return {
      id: item.id,
      name: item.name,
      isFeatured: item.isFeatured,
      isArchived: item.isArchived,
      price: formatter.format(item.price.toNumber()),
      stock,
      category: item.category.name,
      size: sizeLabel,
      color: colorSwatch,
      colorName,
      createdAt: format(item.createdAt, "MMMM do, yyyy"),
    };
  });

  return (
    <div className="flex-col">
      <div className="flex-1 space-y-4 p-8 pt-6">
        <ProductsClient data={formattedProducts} />
      </div>
    </div>
  );
};

export default ProductsPage;
