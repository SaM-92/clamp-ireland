import "server-only";
import { env } from "@/lib/env";
import { AiProviderError } from "./errors";

export function getAiConfiguration() {
  const provider = env.AI_PROVIDER ?? "openai";
  if (provider === "openai") {
    if (!env.OPENAI_API_KEY?.trim()) throw new AiProviderError("unconfigured", "The server AI provider is not configured.", 503);
    return { provider, url: "https://api.openai.com/v1/responses", model: "gpt-5-mini", auth: "api-key" } as const;
  }
  if (provider !== "azure") throw new AiProviderError("unconfigured", "The configured AI provider is not supported.", 503);
  let endpoint: URL;
  try {
    endpoint = new URL(env.AZURE_OPENAI_ENDPOINT);
  } catch {
    throw new AiProviderError("unconfigured", "A valid Azure OpenAI endpoint is required.", 503);
  }
  if (endpoint.protocol !== "https:" || endpoint.port || endpoint.username || endpoint.password ||
      endpoint.pathname !== "/" || endpoint.search || endpoint.hash ||
      !/^[a-z0-9][a-z0-9-]*\.openai\.azure\.com$/.test(endpoint.hostname)) {
    throw new AiProviderError("unconfigured", "Use the Azure OpenAI HTTPS resource origin, without a path or query.", 503);
  }
  const auth = env.AZURE_OPENAI_AUTH_MODE;
  if (auth !== "entra" && auth !== "api-key") throw new AiProviderError("unconfigured", "Choose Entra or API-key authentication for Azure AI.", 503);
  if (auth === "api-key" && !env.AZURE_OPENAI_API_KEY?.trim()) throw new AiProviderError("unconfigured", "The Azure AI server credential is missing.", 503);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(env.AZURE_OPENAI_DEPLOYMENT)) {
    throw new AiProviderError("unconfigured", "A valid Azure model deployment name is required.", 503);
  }
  return { provider, url: new URL("openai/v1/responses", endpoint).href, model: env.AZURE_OPENAI_DEPLOYMENT, auth } as const;
}

export function getAiSetup(): { ready: boolean; message: string } {
  try {
    getAiConfiguration();
    return { ready: true, message: "AI is configured. Inference access is checked when a request is made." };
  } catch (error) {
    if (error instanceof AiProviderError) return { ready: false, message: error.message };
    throw error;
  }
}
