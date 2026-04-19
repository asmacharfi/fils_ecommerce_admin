"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  isTextUIPart,
  isToolUIPart,
  type UIMessage,
} from "ai";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { Bot, Loader2, MessageCircle, Send, Sparkles, User, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { AdminProductSummary } from "@/lib/ai/tools/admin-search-products";
import type { AdminStoreSnapshotOutput } from "@/lib/ai/tools/admin-store-snapshot";

function getTextFromParts(message: UIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((p) => p.text)
    .join("");
}

function getSearchProducts(message: UIMessage): AdminProductSummary[] {
  const out: AdminProductSummary[] = [];
  for (const part of message.parts) {
    if (!isToolUIPart(part)) continue;
    if (part.type !== "tool-searchProducts") continue;
    if (part.state !== "output-available") continue;
    const data = part.output as { products?: AdminProductSummary[] } | undefined;
    if (data?.products?.length) {
      out.push(...data.products);
    }
  }
  const seen = new Set<string>();
  return out.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

function getStoreSnapshot(message: UIMessage): AdminStoreSnapshotOutput | null {
  for (const part of message.parts) {
    if (!isToolUIPart(part)) continue;
    if (part.type !== "tool-storeSnapshot") continue;
    if (part.state !== "output-available") continue;
    return part.output as AdminStoreSnapshotOutput;
  }
  return null;
}

interface AdminAIDrawerProps {
  storeId: string;
}

const AdminAIDrawer = ({ storeId }: AdminAIDrawerProps) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/${storeId}/chat`,
        prepareSendMessagesRequest: ({ id, messages, trigger, messageId, body }) => ({
          body: {
            ...body,
            id,
            messages,
            trigger,
            messageId,
          },
        }),
      }),
    [storeId]
  );

  const { messages, sendMessage, status, error, stop } = useChat({
    transport,
    messages: [
      {
        id: "admin-assistant-welcome",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Ask about inventory, featured products, or store stats. I can search the catalog and summarize orders (read-only).",
            state: "done",
          },
        ],
      },
    ],
  });

  const busy = status === "submitted" || status === "streaming";

  const sendFromText = async (raw: string) => {
    const value = raw.trim();
    if (!value || busy) return;
    setInput("");
    await sendMessage({ text: value });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await sendFromText(input);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition hover:opacity-90"
        aria-label="Open admin assistant"
      >
        <Sparkles className="h-6 w-6" />
      </button>

      <div
        className={`fixed inset-0 z-50 transition ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      >
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        />
        <aside
          className={`absolute right-0 top-0 h-full w-full max-w-md border-l bg-background shadow-2xl transition-transform duration-300 ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex h-full flex-col">
            <div className="border-b p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-5 w-5" />
                  <h2 className="text-lg font-semibold">Admin Assistant</h2>
                </div>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Store: {storeId}</p>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  {error.message}
                  <button type="button" className="ml-2 underline" onClick={() => void stop()}>
                    Stop
                  </button>
                </div>
              )}

              {messages.map((message) => {
                const text = getTextFromParts(message);
                const products = message.role === "assistant" ? getSearchProducts(message) : [];
                const snapshot = message.role === "assistant" ? getStoreSnapshot(message) : null;

                return (
                  <div key={message.id} className="space-y-2">
                    <div
                      className={`flex items-center gap-2 text-xs ${
                        message.role === "assistant" ? "text-muted-foreground" : "text-foreground"
                      }`}
                    >
                      {message.role === "assistant" ? (
                        <Bot className="h-3.5 w-3.5" />
                      ) : (
                        <User className="h-3.5 w-3.5" />
                      )}
                      <span>{message.role === "assistant" ? "Assistant" : "You"}</span>
                    </div>
                    {text ? (
                      <p className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">{text}</p>
                    ) : null}
                    {snapshot && (
                      <div className="rounded-lg border bg-card p-3 text-xs space-y-1">
                        <p className="font-medium">{snapshot.storeName}</p>
                        <p>Active products: {snapshot.activeProductCount}</p>
                        <p>Archived products: {snapshot.archivedProductCount}</p>
                        <p>Orders: {snapshot.orderCount}</p>
                        <p>Unpaid orders: {snapshot.unpaidOrderCount}</p>
                      </div>
                    )}
                    {products.length > 0 && (
                      <ul className="space-y-2 text-sm">
                        {products.map((p) => (
                          <li key={p.id} className="rounded-md border p-2">
                            <Link
                              href={`/${storeId}/products/${p.id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {p.name}
                            </Link>
                            <div className="text-xs text-muted-foreground mt-1">
                              {p.categoryName} · ${p.price}
                              {p.isFeatured ? " · Featured" : ""}
                              {p.isArchived ? " · Archived" : ""}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            <form onSubmit={onSubmit} className="border-t p-3">
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about products or store stats..."
                  className="h-10 flex-1 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={busy}
                />
                <Button type="submit" size="icon" disabled={busy} className="h-10 w-10 shrink-0">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </form>
          </div>
        </aside>
      </div>
    </>
  );
};

export default AdminAIDrawer;
