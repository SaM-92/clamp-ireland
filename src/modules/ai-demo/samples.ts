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

export interface DemoResult {
  source: "azure" | "local-rule";
  kind: "summary" | "policy";
  message: string;
  allowed?: boolean;
  durationMs: number;
  remaining: number;
  cached: boolean;
}
