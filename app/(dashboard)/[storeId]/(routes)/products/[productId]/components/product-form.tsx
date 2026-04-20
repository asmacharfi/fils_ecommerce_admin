"use client";

import * as z from "zod";
import axios from "axios";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "react-hot-toast";
import { Plus, Trash } from "lucide-react";
import { Category, Color, Image, Product, ProductVariant, Size } from "@prisma/client";
import { useParams, useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { Heading } from "@/components/ui/heading";
import { AlertModal } from "@/components/modals/alert-modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ImageUpload from "@/components/ui/image-upload";
import { Checkbox } from "@/components/ui/checkbox";

const variantRowSchema = z.object({
  id: z.string().optional(),
  colorId: z.string(),
  sizeId: z.string(),
  stock: z.coerce.number().int().min(0),
});

const GALLERY_ALL = "__all__";

const imageRowSchema = z.object({
  url: z.string().min(1),
  colorId: z.string().optional().nullable(),
});

const formSchema = z
  .object({
    name: z.string().min(1),
    images: z.array(imageRowSchema).min(1, "At least one image"),
    price: z.coerce.number().min(1),
    categoryId: z.string().min(1),
    description: z.string().optional().default(""),
    simpleInventory: z.boolean().default(false),
    productStock: z.coerce.number().int().min(0),
    variants: z.array(variantRowSchema),
    width: z.string().optional().default(""),
    height: z.string().optional().default(""),
    depth: z.string().optional().default(""),
    isFeatured: z.boolean().default(false).optional(),
    isBillboard: z.boolean().default(false).optional(),
    isArchived: z.boolean().default(false).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.simpleInventory) return;
    if (data.variants.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one variant is required when using colors and sizes.",
        path: ["variants"],
      });
    }
    data.variants.forEach((v, i) => {
      if (!v.colorId?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Color required",
          path: ["variants", i, "colorId"],
        });
      }
      if (!v.sizeId?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Size required",
          path: ["variants", i, "sizeId"],
        });
      }
    });
  });

type ProductFormValues = z.infer<typeof formSchema>;

type InitialProduct = Omit<Product, "price"> & {
  price: string | number;
  images: Image[];
  variants: (ProductVariant & { color: Color; size: Size })[];
};

interface ProductFormProps {
  initialData: InitialProduct | null;
  categories: Category[];
  colors: Color[];
  sizes: Size[];
}

export const ProductForm: React.FC<ProductFormProps> = ({ initialData, categories, sizes, colors }) => {
  const params = useParams();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const title = initialData ? "Edit product" : "Create product";
  const description = initialData ? "Edit a product." : "Add a new product";
  const toastMessage = initialData ? "Product updated." : "Product created.";
  const action = initialData ? "Save changes" : "Create";

  const defaultValues: ProductFormValues = initialData
    ? {
        name: initialData.name,
        images: initialData.images.map((img) => ({
          url: img.url,
          colorId: img.colorId ?? GALLERY_ALL,
        })),
        price: parseFloat(String(initialData.price)),
        categoryId: initialData.categoryId,
        description: initialData.description ?? "",
        simpleInventory: initialData.variants.length === 0,
        productStock: initialData.stock ?? 0,
        variants: initialData.variants.length
          ? initialData.variants.map((v) => ({
              id: v.id,
              colorId: v.colorId,
              sizeId: v.sizeId,
              stock: v.stock,
            }))
          : [],
        width:
          initialData.width != null && !Number.isNaN(Number(initialData.width))
            ? String(initialData.width)
            : "",
        height:
          initialData.height != null && !Number.isNaN(Number(initialData.height))
            ? String(initialData.height)
            : "",
        depth:
          initialData.depth != null && !Number.isNaN(Number(initialData.depth)) ? String(initialData.depth) : "",
        isFeatured: initialData.isFeatured,
        isBillboard: initialData.isBillboard,
        isArchived: initialData.isArchived,
      }
    : {
        name: "",
        images: [],
        price: 0,
        categoryId: "",
        description: "",
        simpleInventory: false,
        productStock: 0,
        variants: [{ colorId: "", sizeId: "", stock: 0 }],
        width: "",
        height: "",
        depth: "",
        isFeatured: false,
        isBillboard: false,
        isArchived: false,
      };

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  const { fields: variantFields, append: appendVariant, remove: removeVariant } = useFieldArray({
    control: form.control,
    name: "variants",
  });

  const onSubmit = async (data: ProductFormValues) => {
    try {
      setLoading(true);
      const parseDim = (s: string) => {
        const t = s?.trim() ?? "";
        if (!t) return null;
        const n = parseFloat(t);
        return Number.isFinite(n) ? n : null;
      };
      const payload = {
        name: data.name,
        price: data.price,
        categoryId: data.categoryId,
        description: data.description,
        isFeatured: data.isFeatured,
        isBillboard: data.isBillboard,
        isArchived: data.isArchived,
        simpleInventory: data.simpleInventory,
        ...(data.simpleInventory ? { stock: data.productStock } : {}),
        width: parseDim(data.width),
        height: parseDim(data.height),
        depth: parseDim(data.depth),
        images: data.images.map((img) => ({
          url: img.url,
          colorId: !img.colorId || img.colorId === GALLERY_ALL ? null : img.colorId,
        })),
        variants: data.simpleInventory
          ? []
          : data.variants.map((v) => ({
              ...(v.id ? { id: v.id } : {}),
              colorId: v.colorId,
              sizeId: v.sizeId,
              stock: v.stock,
            })),
      };
      if (initialData) {
        await axios.patch(`/api/${params.storeId}/products/${params.productId}`, payload);
      } else {
        await axios.post(`/api/${params.storeId}/products`, payload);
      }
      router.refresh();
      router.push(`/${params.storeId}/products`);
      toast.success(toastMessage);
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const onDelete = async () => {
    try {
      setLoading(true);
      await axios.delete(`/api/${params.storeId}/products/${params.productId}`);
      router.refresh();
      router.push(`/${params.storeId}/products`);
      toast.success("Product deleted.");
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  const firstColorId = colors[0]?.id ?? "";

  return (
    <>
      <AlertModal isOpen={open} onClose={() => setOpen(false)} onConfirm={onDelete} loading={loading} />
      <div className="flex items-center justify-between">
        <Heading title={title} description={description} />
        {initialData && (
          <Button disabled={loading} variant="destructive" size="sm" onClick={() => setOpen(true)}>
            <Trash className="h-4 w-4" />
          </Button>
        )}
      </div>
      <Separator />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="w-full space-y-8">
          <FormField
            control={form.control}
            name="images"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Images</FormLabel>
                <FormControl>
                  <ImageUpload
                    value={field.value.map((image) => image.url)}
                    disabled={loading}
                    onChange={(url) =>
                      field.onChange([
                        ...field.value,
                        { url, colorId: firstColorId || GALLERY_ALL },
                      ])
                    }
                    onRemove={(url) => field.onChange([...field.value.filter((current) => current.url !== url)])}
                  />
                </FormControl>
                <FormDescription>Optional: tag each image with a color for the storefront gallery.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {form.watch("images")?.length ? (
            <div className="space-y-3 rounded-md border p-4">
              <p className="text-sm font-medium">Image gallery colors</p>
              {form.watch("images").map((imgRow, index) => (
                <div key={`${imgRow.url}-${index}`} className="flex flex-wrap items-end gap-3">
                  <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{imgRow.url}</div>
                  <FormField
                    control={form.control}
                    name={`images.${index}.colorId`}
                    render={({ field: f }) => (
                      <FormItem>
                        <Select
                          disabled={loading}
                          onValueChange={f.onChange}
                          value={f.value === null || f.value === undefined || f.value === "" ? GALLERY_ALL : f.value}
                        >
                          <FormControl>
                            <SelectTrigger className="w-[180px]">
                              <SelectValue placeholder="All colors" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={GALLERY_ALL}>All colors</SelectItem>
                            {colors.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ))}
            </div>
          ) : null}

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea disabled={loading} placeholder="Product description" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="gap-8 space-y-6 md:grid md:grid-cols-3 md:space-y-0">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input disabled={loading} placeholder="Product name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="price"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Price</FormLabel>
                  <FormControl>
                    <Input type="number" disabled={loading} placeholder="9.99" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select disabled={loading} onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="width"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Width</FormLabel>
                  <FormControl>
                    <Input type="text" disabled={loading} placeholder="e.g. 12" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="height"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Height</FormLabel>
                  <FormControl>
                    <Input type="text" disabled={loading} placeholder="e.g. 8" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="depth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Depth</FormLabel>
                  <FormControl>
                    <Input type="text" disabled={loading} placeholder="e.g. 4" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isFeatured"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      // @ts-ignore
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Featured</FormLabel>
                    <FormDescription>This product will appear on the home page</FormDescription>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isArchived"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      // @ts-ignore
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Archived</FormLabel>
                    <FormDescription>This product will not appear anywhere in the store.</FormDescription>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isBillboard"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      // @ts-ignore
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Billboard Carousel</FormLabel>
                    <FormDescription>This product will be shown in the home page hero carousel.</FormDescription>
                  </div>
                </FormItem>
              )}
            />
          </div>

          <Separator />
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="simpleInventory"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      // @ts-ignore
                      onCheckedChange={(c) => {
                        const next = Boolean(c);
                        field.onChange(next);
                        if (next) {
                          form.setValue("variants", []);
                        } else {
                          form.setValue("variants", [
                            { colorId: firstColorId, sizeId: sizes[0]?.id ?? "", stock: 0 },
                          ]);
                        }
                      }}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>No color or size (single stock)</FormLabel>
                    <FormDescription>
                      For perfume, makeup, etc.: one stock count and no color/size selectors on the store.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            {form.watch("simpleInventory") ? (
              <FormField
                control={form.control}
                name="productStock"
                render={({ field }) => (
                  <FormItem className="max-w-xs">
                    <FormLabel>Stock</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} step={1} disabled={loading} {...field} />
                    </FormControl>
                    <FormDescription>Total units available for this product.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <Heading title="Variants" description="Each color and size combination has its own stock." />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => appendVariant({ colorId: firstColorId, sizeId: sizes[0]?.id ?? "", stock: 0 })}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add variant
                  </Button>
                </div>
                <div className="space-y-4">
                  {variantFields.map((vf, index) => (
                    <div key={vf.id} className="grid gap-4 rounded-lg border p-4 md:grid-cols-4">
                      <FormField
                        control={form.control}
                        name={`variants.${index}.colorId`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Color</FormLabel>
                            <Select disabled={loading} onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Color" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {colors.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`variants.${index}.sizeId`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Size</FormLabel>
                            <Select disabled={loading} onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Size" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {sizes.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {s.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`variants.${index}.stock`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Stock</FormLabel>
                            <FormControl>
                              <Input type="number" min={0} step={1} disabled={loading} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={loading || variantFields.length <= 1}
                          onClick={() => removeVariant(index)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <Button disabled={loading} className="ml-auto" type="submit">
            {action}
          </Button>
        </form>
      </Form>
    </>
  );
};
