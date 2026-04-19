import { auth } from "@clerk/nextjs";
import { NextResponse } from "next/server";
import { createAgentUIStreamResponse } from "ai";

import { createAdminStoreAgent } from "@/lib/ai/admin-agent";
import { getChatModelEnvError } from "@/lib/ai/create-chat-model";
import prismadb from "@/lib/prismadb";

export async function POST(
  req: Request,
  { params }: { params: { storeId: string } }
) {
  try {
    const modelEnvError = getChatModelEnvError();
    if (modelEnvError) {
      return NextResponse.json({ error: modelEnvError }, { status: 500 });
    }

    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }

    if (!params.storeId) {
      return NextResponse.json({ error: "Store id is required" }, { status: 400 });
    }

    const store = await prismadb.store.findFirst({
      where: {
        id: params.storeId,
        userId,
      },
    });

    if (!store) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = (await req.json()) as {
      messages?: unknown[];
    };

    const uiMessages = Array.isArray(body.messages) ? body.messages : [];
    const agent = createAdminStoreAgent(params.storeId);

    return await createAgentUIStreamResponse({
      agent,
      uiMessages,
    });
  } catch (error) {
    console.error("[ADMIN_CHAT_POST]", error);
    return NextResponse.json(
      { error: "Something went wrong while processing your request." },
      { status: 500 }
    );
  }
}
