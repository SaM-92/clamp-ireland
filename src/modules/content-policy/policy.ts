export type ContentKind = "report_note" | "username";

export const CONTENT_LIMITS = { report_note: 2000, username: 24 } as const;
export const POLICY_REJECTION_MESSAGE =
  "Please remove profanity, abuse, threats or impersonation before continuing. Factual, non-abusive criticism is welcome.";
export const POLICY_UNAVAILABLE_MESSAGE =
  "Content checks are temporarily unavailable. Nothing was submitted. Please try again shortly.";

export class ContentPolicyError extends Error {
  constructor(
    public readonly code: "content_policy_rejected" | "content_policy_unavailable" | "invalid_content" | "content_policy_rate_limited",
    public readonly status: 400 | 422 | 429 | 503,
    message: string,
  ) {
    super(message);
    this.name = "ContentPolicyError";
  }
}

export function normalizeContent(text: string): string {
  return text.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/\s+/gu, " ").trim();
}

const profanity = [
  "fuck", "fucks", "fucking", "fucker", "fuckers", "fucked", "motherfucker", "motherfuckers",
  "shit", "shits", "shitty", "shite", "bullshit", "bitch", "bitches", "bastard", "bastards",
  "cunt", "cunts", "asshole", "assholes", "arsehole", "arseholes", "dickhead", "wanker", "wankers",
];
const confusables: Record<string, string> = {
  "\u0430": "a", "\u0435": "e", "\u0456": "i", "\u043e": "o", "\u0440": "p",
  "\u0441": "c", "\u0443": "y", "\u0445": "x", "\u0455": "s", "\u04bb": "h",
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i",
};
const profanityPatterns = profanity.map((word) =>
  new RegExp(`(?:^|[^a-z0-9])${[...word].map((letter, index) =>
    index === 0 || index === word.length - 1 ? letter : `[${letter}*]`).join("[\\W_]*")}(?=$|[^a-z0-9])`, "i"),
);

/** Cheap checks are deliberately word-bounded: "Scunthorpe" and "class" are not profanity. */
export function validateContent(kind: ContentKind, input: unknown): string {
  if (typeof input !== "string" || input.length > CONTENT_LIMITS[kind] || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input)) {
    throw new ContentPolicyError("invalid_content", 400, kind === "username"
      ? "Choose a username of 3 to 24 letters, numbers or underscores, starting with a letter."
      : "Describe what happened using 1 to 2000 characters.");
  }
  const normalized = normalizeContent(input);
  const text = kind === "username" ? normalized.toLowerCase() : normalized;
  if (!text || text.length > CONTENT_LIMITS[kind] || (kind === "username" && !/^[a-z][a-z0-9_]{2,23}$/.test(text))) {
    throw new ContentPolicyError("invalid_content", 400, kind === "username"
      ? "Choose a username of 3 to 24 letters, numbers or underscores, starting with a letter."
      : "Describe what happened using 1 to 2000 characters.");
  }
  const folded = text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[аеіорсухѕһ013457@$!]/gu, (character) => confusables[character] ?? character);
  if (profanityPatterns.some((pattern) => pattern.test(folded))
    || (kind === "username" && /^(admin|administrator|moderator|official|support|clamp_?ireland)(?:_.*|\d*)$/.test(text))
    || /\bignore\b.{0,40}\b(previous|above|system|instructions)\b/i.test(text)
    || /\b(system|developer)\s+prompt\b/i.test(text)
    || /["']?allowed["']?\s*[:=]\s*true/i.test(text)) {
    throw new ContentPolicyError("content_policy_rejected", 422, POLICY_REJECTION_MESSAGE);
  }
  return text;
}
