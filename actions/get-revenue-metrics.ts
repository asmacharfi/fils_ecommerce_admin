import { cache } from "react";

import prismadb from "@/lib/prismadb";

export interface GraphRevenuePoint {
  name: string;
  total: number;
}

interface RevenueMetrics {
  totalRevenue: number;
  graphRevenue: GraphRevenuePoint[];
}

const getPaidOrders = cache(async (storeId: string) => {
  return prismadb.order.findMany({
    where: {
      storeId,
      isPaid: true,
    },
    select: {
      createdAt: true,
      orderItems: {
        select: {
          quantity: true,
          product: {
            select: {
              price: true,
            },
          },
        },
      },
    },
  });
});

export const getRevenueMetrics = cache(async (storeId: string): Promise<RevenueMetrics> => {
  const paidOrders = await getPaidOrders(storeId);
  const graphRevenue: GraphRevenuePoint[] = [
    { name: "Jan", total: 0 },
    { name: "Feb", total: 0 },
    { name: "Mar", total: 0 },
    { name: "Apr", total: 0 },
    { name: "May", total: 0 },
    { name: "Jun", total: 0 },
    { name: "Jul", total: 0 },
    { name: "Aug", total: 0 },
    { name: "Sep", total: 0 },
    { name: "Oct", total: 0 },
    { name: "Nov", total: 0 },
    { name: "Dec", total: 0 },
  ];

  let totalRevenue = 0;

  for (const order of paidOrders) {
    let orderTotal = 0;

    for (const item of order.orderItems) {
      orderTotal += item.product.price.toNumber() * item.quantity;
    }

    totalRevenue += orderTotal;
    graphRevenue[order.createdAt.getMonth()].total += orderTotal;
  }

  return {
    totalRevenue,
    graphRevenue,
  };
});
