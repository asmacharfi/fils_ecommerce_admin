import { stepCountIs, ToolLoopAgent } from "ai";

import { createChatLanguageModel } from "@/lib/ai/create-chat-model";
import { createAdminSearchProductsTool } from "@/lib/ai/tools/admin-search-products";
import { createAdminStoreSnapshotTool } from "@/lib/ai/tools/admin-store-snapshot";

const baseInstructions = `You are an AI assistant for the store owner dashboard.

## Capabilities
- You can inspect catalog data and store-level stats using tools.
- All tools are **read-only**. Never claim you created, updated, deleted, or published anything.

## Style
- Be concise and actionable.
- When listing products, include id, price, category, and flags (featured/archived) when relevant.
- Deep links use the pattern \`/{storeId}/products/{productId}\` (you will be given storeId in context).

## Safety
- Only discuss data for this store.
- If asked to change data, explain that changes must be done in the dashboard UI.`;

export function createAdminStoreAgent(storeId: string) {
  const storeBlock = `\n\n## Store context\n- storeId: ${storeId}\n`;

  return new ToolLoopAgent({
    id: "admin-store-agent",
    model: createChatLanguageModel(),
    instructions: `${baseInstructions}${storeBlock}`,
    tools: {
      searchProducts: createAdminSearchProductsTool(storeId),
      storeSnapshot: createAdminStoreSnapshotTool(storeId),
    },
    stopWhen: stepCountIs(12),
  });
}
