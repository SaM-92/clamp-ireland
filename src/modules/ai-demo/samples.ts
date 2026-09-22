import { z } from "zod";
import { summarySentenceSchema } from "@/modules/area-summaries/types";
import { POLICY_TEXT } from "@/modules/content-policy/policy";

export const DEMO_NOTES = [
  "I was clamped after parking in a visitor space without displaying a permit.",
  "The visitor permit instructions were hard to read from the entrance.",
  "I found a permit sign beside the parking spaces when I walked closer.",
] as const;

export const DEMO_CASES = {
  summary: { title: "One-sentence summary", text: "Summarise the three synthetic notes below.", kind: "summary" },
  "allowed-note": { title: "Factual criticism", text: "The sign was difficult to read and I disagree with the clamping charge.", kind: "report" },
  "abusive-note": { title: "Personal abuse", text: "Everyone living here is worthless scum and should be driven out.", kind: "report" },
  "unsafe-username": { title: "Abusive username", text: "fuck_everyone", kind: "username" },
} as const;

export type DemoCase = keyof typeof DEMO_CASES;
export const DEMO_REQUEST_LIMIT = 10;

const metadata = {
  durationMs: z.number().nonnegative(),
  remaining: z.number().int().min(0).max(DEMO_REQUEST_LIMIT),
  cached: z.boolean(),
};
export const demoResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...metadata, source: z.literal("azure"), kind: z.literal("summary"), message: summarySentenceSchema,
  }),
  z.strictObject({
    ...metadata, source: z.enum(["azure", "local-rule"]), kind: z.literal("policy"),
    decision: z.enum(["approve", "blocked"]),
    text: z.enum([POLICY_TEXT.allowed, POLICY_TEXT.profanity, POLICY_TEXT.abuse, POLICY_TEXT.unsafe_username, POLICY_TEXT.prompt_injection]),
  }).refine((value) => (value.decision === "approve") === (value.text === POLICY_TEXT.allowed)),
]);
export type DemoResult = z.infer<typeof demoResultSchema>;
export type DemoOutput = Omit<Extract<DemoResult, { kind: "summary" }>, "remaining" | "cached">
  | Omit<Extract<DemoResult, { kind: "policy" }>, "remaining" | "cached">;
