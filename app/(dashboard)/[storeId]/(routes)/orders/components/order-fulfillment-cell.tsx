"use client";

import axios from "axios";
import { useParams } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { OrderColumn } from "./columns";

type Props = {
  row: OrderColumn;
};

export function OrderFulfillmentCell({ row }: Props) {
  const params = useParams();
  const storeId = params.storeId as string;
  const [status, setStatus] = useState(row.fulfillmentStatus);
  const [tracking, setTracking] = useState(row.trackingNumber);
  const [saving, setSaving] = useState(false);

  if (!row.isPaid) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }

  const save = async (nextStatus?: typeof status, nextTracking?: string) => {
    setSaving(true);
    try {
      await axios.patch(`/api/${storeId}/orders/${row.id}`, {
        fulfillmentStatus: nextStatus ?? status,
        trackingNumber: nextTracking ?? tracking,
      });
      if (nextStatus) setStatus(nextStatus);
      if (nextTracking !== undefined) setTracking(nextTracking);
      toast.success("Order updated");
    } catch {
      toast.error("Could not update order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-[200px] flex-col gap-2 py-1">
      <Select
        value={status}
        onValueChange={(v) => {
          const next = v as typeof status;
          setStatus(next);
          void save(next, tracking);
        }}
        disabled={saving}
      >
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="PROCESSING">Processing</SelectItem>
          <SelectItem value="SHIPPED">Shipped</SelectItem>
          <SelectItem value="DELIVERED">Delivered</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex gap-1">
        <Input
          className="h-8 text-xs"
          placeholder="Tracking #"
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 shrink-0 px-2 text-xs"
          disabled={saving}
          onClick={() => save(undefined, tracking)}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
