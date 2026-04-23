"use client";

import { ColumnDef } from "@tanstack/react-table";

import { OrderFulfillmentCell } from "@/app/(dashboard)/[storeId]/(routes)/orders/components/order-fulfillment-cell";

export type OrderColumn = {
  id: string;
  phone: string;
  address: string;
  isPaid: boolean;
  fulfillmentStatus: "PROCESSING" | "SHIPPED" | "DELIVERED";
  trackingNumber: string;
  totalPrice: string;
  products: string;
  createdAt: string;
  statusLabel: string;
};

export const columns: ColumnDef<OrderColumn>[] = [
  {
    accessorKey: "products",
    header: "Products",
  },
  {
    accessorKey: "statusLabel",
    header: "Status",
  },
  {
    id: "fulfillment",
    header: "Fulfillment",
    cell: ({ row }) => <OrderFulfillmentCell row={row.original} />,
  },
  {
    accessorKey: "phone",
    header: "Phone",
  },
  {
    accessorKey: "address",
    header: "Address",
  },
  {
    accessorKey: "totalPrice",
    header: "Total price",
  },
  {
    accessorKey: "isPaid",
    header: "Paid",
  },
];
