import "server-only";

export class AiProviderError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 502) {
    super(message);
    this.name = "AiProviderError";
  }
}
