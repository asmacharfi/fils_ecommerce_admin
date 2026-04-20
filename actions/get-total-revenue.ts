import { getRevenueMetrics } from "@/actions/get-revenue-metrics";

export const getTotalRevenue = async (storeId: string) => {
  return (await getRevenueMetrics(storeId)).totalRevenue;
};
