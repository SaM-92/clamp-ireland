# Azure AI integration

## Shared server provider

`src/modules/ai/server` owns configuration, authentication, bounded Responses
requests and structured-response parsing. Summary and content-policy modules
own their separate instructions and domain validation. There is no hosted
agent, background inference loop or browser model credential.

The existing Azure GPT-5 mini deployment is the intended low-cost model.
Set `AI_PROVIDER=azure`, `AZURE_OPENAI_ENDPOINT` to the HTTPS OpenAI resource
origin, and `AZURE_OPENAI_DEPLOYMENT=gpt-5-mini`. Real resource identifiers stay
in ignored/private configuration, never this public repository.

`AZURE_OPENAI_AUTH_MODE=entra` uses Azure CLI credentials locally and a managed
identity in production. The identity needs inference permission on the existing
AI resource; management access alone does not establish that. A user-assigned
identity can be selected with `AZURE_CLIENT_ID`. This implementation creates no
roles or identities. Explicit `api-key` mode is available with a server-only
`AZURE_OPENAI_API_KEY`; there is no automatic key fallback.

`AI_PROVIDER=openai` retains the earlier OpenAI path and uses `OPENAI_API_KEY`.
Azure configuration errors never silently fall back to OpenAI. The existing
summary database contract still records GPT-5 mini, so do not point its
deployment setting at a different model without updating that contract.

## Safeguards

- Only the configured Azure OpenAI HTTPS resource origin is accepted.
- Fixed v1 Responses path, no redirects, tools, streaming, storage or retries.
- At most 96,000 input bytes, 1,024 output tokens, 30 seconds and 65,536 response
  bytes; domain modules impose additional limits.
- Exactly one completed assistant JSON output; refusal, incomplete output,
  malformed JSON, authentication/network failures and quota errors are explicit.
- Provider bodies, credentials and submitted text are not included in errors.
- Public reviewed-summary reads remain independent of AI credentials.
- Summary generation remains admin-triggered with cache/freshness checks and
  separate human approval. Browsing a map never generates a summary.
- Content-policy inference is separate from summary generation. The public
  app's server may need its own inference identity for submission checks; that
  does not give its browser clients model access.

GlobalStandard deployment does not promise EU-only processing. Review the
privacy notice, Azure processing terms and region/SKU choice before sending
production community text. A small-model classifier is not a perfect safety
filter or a substitute for human review.

## Verification status

Mocked runtime tests exercise both provider transports, managed identity,
configuration rejection, strict output parsing, timeouts, request bounds,
existing summary caching and public/admin isolation. These tests forbid live
network calls and do not establish production inference access.

## Local demonstration

With the ignored `.env.local` configured for Azure, set
`ENABLE_LOCAL_AI_DEMO=true` and run:

```powershell
npm run dev -- --hostname 127.0.0.1 --port 3001
```

Open `http://localhost:3001/dev/ai-demo`, or use the map's local-preview link.
The page offers fixed synthetic samples: a one-sentence summary, allowed
factual criticism, abusive report text and an abusive username. It labels
actual Azure output, deterministic local-rule rejection and cached output
separately. No accounts, private reports or image uploads are involved.
Classifier responses use `decision: "approve" | "blocked"` with application-owned
`text`; model-selected reason codes map to fixed plain-English explanations.
Only summaries contain generated prose, validated to at most 20 words and
160 characters. The strict demo response schema separates these two shapes.

The API is development-only, explicitly enabled, same-origin and loopback
restricted. It accepts only a fixed example identifier, never arbitrary text
or model settings. Production returns 404 even if the flag is accidentally
enabled. Bind the development server to loopback; do not publish it.
The admin remains locked without its two approved real identities.

`.local/ai-demo-budget.json` tracks a hard ten-attempt limit across process
restarts. A file lock prevents concurrent workers exceeding the limit.
Authentication failures/timeouts consume an attempt too. Corrupt state,
an inaccessible directory or an orphan lock blocks further calls. Do not
reset the counter or remove a lock while an attempt is running; new spending
requires owner approval. Successful samples are cached in process memory,
not in the community database. Restarting loses that cache, not the counter.

The owner approved at most ten short synthetic local requests. Initial live
verification used **three model calls**: the summary returned one valid
sentence, factual criticism was allowed, and personal abuse was blocked.
The unsafe username was rejected by a deterministic rule without a model call.
This proves local inference through the signed-in Azure CLI identity, not
production managed-identity permissions or classifier completeness.

The initial v1 live summary was too verbose. The v2 contract now asks for
8-12 words and rejects anything exceeding 20 words or 160 characters.
Old database summaries are invalidated by prepared migration 0007, not
silently shortened or reapproved. Local process caches are also discarded
when the changed route is reloaded; the persistent spending counter is not.

The refinement's live Azure check returned a **13-word, 92-character** draft:

> Reports mention visitors risk clamping for parking without a clearly visible permit display.

Personal abuse returned `blocked` with the fixed abuse explanation; the
unsafe username returned the fixed profanity explanation without inference.
One earlier noncompliant summary was rejected rather than displayed, then
the concise-caption instructions were tightened. These three refinement
attempts stayed within the original ten-attempt budget; there were no
automatic retries or counter resets.

The refinement passed 39 targeted unit/server contracts, 10 summary SQL
checks, nine browser checks (one production-only case skipped in dev),
lint, both type checks and both production builds. As before, a few synthetic
live examples are not a classifier-quality or factual-grounding certification.

Map-local notes use deterministic checks only and remain entirely in the
browser. They never silently send private preview text to Azure. Their human
approval is simulated, not a real moderation decision. The synthetic demo
does not exercise live PostGIS selection within 500 metres.

No production deployment, model deployment, live migration or Azure role
change was performed.
