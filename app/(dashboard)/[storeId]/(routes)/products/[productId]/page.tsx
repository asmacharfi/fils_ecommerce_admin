import prismadb from "@/lib/prismadb";

import { ProductForm } from "./components/product-form";

const ProductPage = async ({
  params
}: {
  params: { productId: string, storeId: string }
}) => {
  const [product, categories, sizes, colors] = await Promise.all([
    prismadb.product.findUnique({
      where: {
        id: params.productId,
      },
      include: {
        images: true,
        variants: {
          include: {
            color: true,
            size: true,
          },
        },
      },
    }),
    prismadb.category.findMany({
      where: {
        storeId: params.storeId,
      },
    }),
    prismadb.size.findMany({
      where: {
        storeId: params.storeId,
      },
    }),
    prismadb.color.findMany({
      where: {
        storeId: params.storeId,
      },
    }),
  ]);

  return ( 
    <div className="flex-col">
      <div className="flex-1 space-y-4 p-8 pt-6">
        <ProductForm 
          categories={categories} 
          colors={colors}
          sizes={sizes}
          initialData={
            product
              ? {
                  ...product,
                  price: product.price.toString(),
                }
              : null
          }
        />
      </div>
    </div>
  );
}

export default ProductPage;
