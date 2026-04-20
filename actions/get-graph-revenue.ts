import { getRevenueMetrics, type GraphRevenuePoint } from "@/actions/get-revenue-metrics";

export const getGraphRevenue = async (storeId: string): Promise<GraphRevenuePoint[]> => {
  return (await getRevenueMetrics(storeId)).graphRevenue;
};
