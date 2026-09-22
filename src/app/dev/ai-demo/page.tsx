import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AiDemo } from "@/modules/ai-demo/components/AiDemo";
import { isLoopbackOrigin, localAiDemoEnabled } from "@/modules/ai-demo/server/guard";
import { remainingDemoRequests } from "@/modules/ai-demo/server/budget";
import { getAiSetup } from "@/modules/ai/server/config";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Local AI demonstration", robots: { index: false, follow: false } };

export default async function AiDemoPage() {
  const requestHeaders = await headers();
  if (!localAiDemoEnabled() || !isLoopbackOrigin(`http://${requestHeaders.get("host")}`)) notFound();
  const setup = getAiSetup();
  const azure = env.AI_PROVIDER === "azure";
  let remaining = 0;
  let budgetError = "";
  try { remaining = await remainingDemoRequests(); }
  catch { budgetError = "The local demo budget could not be read. No model requests are allowed."; }
  return <AiDemo ready={setup.ready && azure && !budgetError} remaining={remaining}
    setupMessage={budgetError || (!azure ? "This demonstration requires the Azure AI provider." : setup.message)} />;
}
