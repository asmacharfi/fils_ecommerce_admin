import { createOpenAI } from "@ai-sdk/openai";

export type AiProviderKind = "openai" | "openrouter";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const DEFAULT_MODEL: Record<AiProviderKind, string> = {
  openai: "gpt-4o-mini",
  /** OpenRouter free tier; avoids paid default when AI_MODEL is unset. */
  openrouter: "openai/gpt-oss-120b:free",
};

export function resolveAiProvider(): AiProviderKind {
  const raw = (process.env.AI_PROVIDER ?? "").toLowerCase().trim();
  if (raw === "openrouter") return "openrouter";
  if (raw === "openai") return "openai";

  const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY?.trim());

  if (hasOpenRouterKey && !hasOpenAiKey) return "openrouter";
  if (hasOpenAiKey && !hasOpenRouterKey) return "openai";
  if (hasOpenRouterKey && hasOpenAiKey) return "openrouter";

  return "openai";
}

/**
 * Returns a configured chat model for either OpenAI or OpenRouter.
 * - `AI_PROVIDER=openai|openrouter` forces the provider.
 * - If `AI_PROVIDER` is omitted: only OpenRouter key → OpenRouter; only OpenAI key → OpenAI; both → OpenRouter.
 * - OpenRouter: `OPENROUTER_API_KEY`, optional `OPENROUTER_HTTP_REFERER` / `OPENROUTER_APP_TITLE`.
 * - OpenAI: `OPENAI_API_KEY`, optional `AI_MODEL` (default `gpt-4o-mini` on OpenAI, `openai/gpt-oss-120b:free` on OpenRouter when unset).
 */
export function createChatLanguageModel() {
  const provider = resolveAiProvider();
  const modelId = (process.env.AI_MODEL || "").trim() || DEFAULT_MODEL[provider];

  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is required when AI_PROVIDER=openrouter");
    }

    const referer =
      process.env.OPENROUTER_HTTP_REFERER?.trim() ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
      "http://localhost:3000";

    const openrouter = createOpenAI({
      baseURL: OPENROUTER_BASE_URL,
      apiKey,
      name: "openrouter",
      headers: {
        "HTTP-Referer": referer,
        "X-Title": process.env.OPENROUTER_APP_TITLE?.trim() || "Admin assistant",
      },
    });

    return openrouter.chat(modelId);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const openai = createOpenAI({ apiKey });
  return openai.chat(modelId);
}

/** For route handlers: env check without throwing. */
export function getChatModelEnvError(): string | null {
  const provider = resolveAiProvider();
  if (provider === "openrouter") {
    return process.env.OPENROUTER_API_KEY?.trim()
      ? null
      : "OPENROUTER_API_KEY is not configured. Add it (and optionally AI_PROVIDER=openrouter).";
  }
  return process.env.OPENAI_API_KEY?.trim()
    ? null
    : "OPENAI_API_KEY is not configured. Add it, or set OPENROUTER_API_KEY (OpenRouter is used automatically when it is the only key, or when both keys are set and AI_PROVIDER is omitted).";
}
