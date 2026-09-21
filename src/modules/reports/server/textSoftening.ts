import "server-only";
import { env } from "@/lib/env";

export interface TextSoftener {
  soften(rawText: string): Promise<string>;
}

const SHOUTING_WORD = /\b[A-Z]{4,}\b/g;

/**
 * Zero-dependency fallback: tones down shouting/punctuation without an AI
 * call. Used whenever no AI provider key is configured, and as a safe
 * default for local development.
 */
const heuristicSoftener: TextSoftener = {
  async soften(rawText) {
    let text = rawText.trim();
    text = text.replace(SHOUTING_WORD, (word) => word.charAt(0) + word.slice(1).toLowerCase());
    text = text.replace(/!{2,}/g, ".");
    return text;
  },
};

/**
 * Returns the text softener used for every report description before
 * publish (see docs/00-product-plan.md, "Decisions added (2026-09-21):
 * moderation pipeline refinement" — text reports go through an AI
 * rephrasing pass that softens tone and strips stray names, while
 * preserving the facts).
 *
 * TODO(next agent): when OPENAI_API_KEY (or another provider) is
 * configured, implement a real call here that rewrites `rawText` into a
 * neutral, factual tone and removes any named individuals/companies while
 * keeping time/location/what-happened facts intact. Keep the
 * `soften(rawText): Promise<string>` interface so this is a one-file swap.
 */
export function getTextSoftener(): TextSoftener {
  if (!env.OPENAI_API_KEY) {
    return heuristicSoftener;
  }
  // Placeholder until a real provider is wired up — see TODO above.
  return heuristicSoftener;
}
