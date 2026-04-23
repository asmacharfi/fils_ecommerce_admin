import { format } from "date-fns";

import prismadb from "@/lib/prismadb";
import { formatter } from "@/lib/utils";

import { OrderColumn } from "./components/columns"
import { OrderClient } from "./components/client";


const OrdersPage = async ({
  params
}: {
  params: { storeId: string }
}) => {
  const orders = await prismadb.order.findMany({
    where: {
      storeId: params.storeId
    },
    select: {
      id: true,
      phone: true,
      address: true,
      isPaid: true,
      fulfillmentStatus: true,
      trackingNumber: true,
      createdAt: true,
      orderItems: {
        select: {
          quantity: true,
          product: {
            select: {
              name: true,
              price: true,
            },
          },
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  const formattedOrders: OrderColumn[] = orders.map((item) => ({
    id: item.id,
    phone: item.phone,
    address: item.address,
    products: item.orderItems
      .map((orderItem) =>
        orderItem.quantity > 1
          ? `${orderItem.product.name} ×${orderItem.quantity}`
          : orderItem.product.name
      )
      .join(", "),
    totalPrice: formatter.format(
      item.orderItems.reduce((total, oi) => {
        return total + Number(oi.product.price) * oi.quantity;
      }, 0)
    ),
    isPaid: item.isPaid,
    fulfillmentStatus: item.fulfillmentStatus,
    trackingNumber: item.trackingNumber,
    statusLabel: item.isPaid
      ? item.fulfillmentStatus === "SHIPPED"
        ? "Shipped"
        : item.fulfillmentStatus === "DELIVERED"
          ? "Delivered"
          : "Processing"
      : "Awaiting payment",
    createdAt: format(item.createdAt, 'MMMM do, yyyy'),
  }));

  return (
    <div className="flex-col">
      <div className="flex-1 space-y-4 p-8 pt-6">
        <OrderClient data={formattedOrders} />
      </div>
    </div>
  );
};

export default OrdersPage;
