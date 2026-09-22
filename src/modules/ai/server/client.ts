import "server-only";
import { AzureCliCredential, ManagedIdentityCredential } from "@azure/identity";
import { z } from "zod";
import { env } from "@/lib/env";
import { readBoundedJson } from "@/lib/server/readBoundedJson";
import { getAiConfiguration } from "./config";
import { AiProviderError } from "./errors";

export { AiProviderError } from "./errors";

export interface StructuredRequest {
  instructions: string;
  input: string;
  format: { type: "json_schema"; name: string; strict: true; schema: Record<string, unknown> };
  maxOutputTokens: number;
  timeoutMs?: number;
}

const responseSchema = z.object({
  status: z.string(),
  error: z.unknown().nullish(),
  output: z.array(z.object({
    type: z.string(), role: z.string().optional(), status: z.string().optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })),
});

export function parseStructuredResponse(value: unknown): unknown {
  const parsed = responseSchema.safeParse(value);
  const malformed = () => new AiProviderError("provider_malformed", "AI returned invalid structured output. Nothing was accepted.");
  if (!parsed.success) throw malformed();
  const response = parsed.data;
  if (response.status === "incomplete") throw new AiProviderError("provider_incomplete", "AI could not finish within the output budget.");
  if (response.status !== "completed" || response.error != null) throw new AiProviderError("provider_failed", "AI did not complete the request.");
  const texts: string[] = [];
  for (const item of response.output) {
    if (item.type === "reasoning") continue;
    if (item.type !== "message" || item.role !== "assistant" || item.status !== "completed" || !item.content) throw malformed();
    for (const content of item.content) {
      if (content.type === "refusal") throw new AiProviderError("provider_refusal", "AI declined to process this request.", 422);
      if (content.type !== "output_text" || typeof content.text !== "string") throw malformed();
      texts.push(content.text);
    }
  }
  if (texts.length !== 1) throw malformed();
  try {
    return JSON.parse(texts[0]);
  } catch {
    throw malformed();
  }
}

let credential: AzureCliCredential | ManagedIdentityCredential | undefined;

async function authorization(config: ReturnType<typeof getAiConfiguration>, signal: AbortSignal): Promise<Record<string, string>> {
  if (config.provider === "openai") return { Authorization: `Bearer ${env.OPENAI_API_KEY}` };
  if (config.auth === "api-key") return { "api-key": env.AZURE_OPENAI_API_KEY };
  credential ??= env.NODE_ENV === "production"
    ? new ManagedIdentityCredential(env.AZURE_CLIENT_ID ? { clientId: env.AZURE_CLIENT_ID } : {})
    : new AzureCliCredential({ processTimeoutInMs: 7_000 });
  try {
    const token = await credential.getToken("https://ai.azure.com/.default", { abortSignal: signal });
    if (!token?.token) throw new Error("No access token");
    return { Authorization: `Bearer ${token.token}` };
  } catch {
    throw new AiProviderError("provider_auth", "AI authentication is unavailable. Check the server identity and its inference permissions.", 503);
  }
}

export async function requestStructuredOutput(options: StructuredRequest, fetcher: typeof fetch = fetch): Promise<unknown> {
  const config = getAiConfiguration();
  if (new TextEncoder().encode(options.instructions + options.input).length > 96_000 ||
      !Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 1 || options.maxOutputTokens > 1_024 ||
      (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30_000))) {
    throw new AiProviderError("input_limit", "The AI request exceeds its input, output or time budget.", 400);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const headers = await authorization(config, controller.signal);
    controller.signal.throwIfAborted();
    const response = await fetcher(config.url, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      cache: "no-store", redirect: "error", signal: controller.signal,
      body: JSON.stringify({
        model: config.model, instructions: options.instructions, input: options.input,
        text: { format: options.format }, reasoning: { effort: "minimal" },
        max_output_tokens: options.maxOutputTokens, store: false, stream: false,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new AiProviderError("provider_rate_limit", "AI rate or quota limit reached. No automatic retry was made.", 429);
      throw new AiProviderError("provider_http", "AI could not process the request. Check provider access and availability.");
    }
    return parseStructuredResponse(await readBoundedJson(response, 65_536,
      new AiProviderError("provider_malformed", "AI returned invalid or oversized JSON.")));
  } catch (error) {
    if (controller.signal.aborted) throw new AiProviderError("provider_timeout", "AI checking timed out. No automatic retry was made; a provider charge may still apply.", 504);
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError("provider_network", "Could not reach AI. No automatic retry was made.");
  } finally {
    clearTimeout(timer);
  }
}
