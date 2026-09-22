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

The owner approved at most ten short synthetic local demonstration requests.
The demonstration and its live result are being integrated separately; no live
inference success or production deployment is claimed by this handoff yet.
