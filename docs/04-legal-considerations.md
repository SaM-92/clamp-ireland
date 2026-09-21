# Legal Considerations (v1) — informational research, NOT legal advice

Depends on: `00-product-plan.md`. This document summarizes publicly available
Irish/EU legal information relevant to the product decisions already made. It
is background research to reduce risk and inform a real legal consultation —
**it is not a substitute for advice from a solicitor**, and before public
launch (even a small community MVP) a short consultation with an Irish
solicitor familiar with defamation/GDPR is the responsible next step, given
this app is specifically about calling out businesses' conduct.

## Bottom line
The concept is **legally workable** if (and only if) it's built the way it's
currently planned: location-only risk scoring, no app-asserted accusations
against named companies, light-touch moderation, and a real notice-and-action
process. Three areas need concrete engineering/policy work, listed below —
none of them are blockers, but two of them (image redaction, notice-and-action)
should move from "nice to have" to **required for launch**.

## 1. Existing regulatory framework actually helps this project
Ireland already regulates private clamping under the **Vehicle Clamping Act
2015**, enforced by the **National Transport Authority (NTA)**:
- Clamping operators are legally required to post compliant signage (Vehicle
  Clamping and Signage Regulations 2017) and a Code of Practice.
- A statutory **two-stage appeals process** exists (operator first, then an
  independent NTA-appointed appeals officer).
- Implication for the product: the app can legitimately host user reports
  about *signage clarity / location risk*, and can link to the official NTA
  appeals process as a genuinely useful feature — this reframes the app as
  "helping people exercise existing legal rights + share experience," not as
  a vigilante accusation board. Worth a "How to appeal a clamp" info page.

## 2. Defamation (Defamation Act 2009)
- **Section 27** provides an "innocent publication" defence for a platform
  operator who is **not** the author/editor/publisher of a statement, took
  reasonable care, and had no reason to believe it was defamatory.
- Practical consequence for our design: **do not manually edit or curate
  individual user reports' content** (light automated checks like profanity
  filters are fine; hand-editing user text risks becoming "editor").
  This matches the already-agreed "light auto-checks then auto-publish"
  decision — good alignment, keep it that way.
- "Reasonable care" is judged partly on whether you **act promptly on
  notice** — this is exactly what the Phase 3 flag/takedown feature must
  deliver in practice, not just exist on paper.
- The already-agreed "location-only risk score, no structured/scored company
  entity" decision is the single biggest risk reducer here — it avoids the
  app itself making a reputational assertion about a named business.

## 3. EU Digital Services Act (DSA) — Ireland enforces via Coimisiún na Meán
As a hosting/intermediary service, even a small one, the app should have:
- A clear, easy **notice-and-action mechanism** for anyone to report illegal
  content (this is the same flag button already planned — needs a documented
  process behind it, not just a DB flag).
- A **single point of contact** (an email address is enough) published in
  the ToS/footer.
- A **statement of reasons** given to a user when their content is removed,
  plus a way to contest it.
- Micro/small enterprises get exemptions from some heavier DSA duties (e.g.
  formal transparency reporting, out-of-court dispute bodies) — but the
  notice-and-action mechanism and point of contact are baseline expectations
  regardless of size. Confirm current thresholds with a solicitor before
  launch since exemption rules can be revised.
- **Action:** Phase 3 in the roadmap already has "flag/report + admin
  takedown" — extend it to include a documented reasons/appeal step and a
  published contact address; add explicit ToS language.

## 4. GDPR — the part that most changes the build
- A **vehicle registration plate visible in a photo counts as personal
  data** once linkable to a person (which, in Ireland, it generally is).
  Photos will also often capture bystanders, other cars, house numbers, etc.
- Consent from every plate owner is impractical for this use case, and
  "legitimate interest" is usable but requires a documented balancing test
  and, per current regulatory guidance, an expectation that you **minimize**
  what's published.
- **Recommended, and now added as a required (not optional) build step:**
  auto-detect and blur license plates and faces server-side before an image
  is stored/published (there are free/open-source models for both plate and
  face detection — this can run at upload time in the same step as EXIF
  stripping). This substantially de-risks GDPR exposure and also better
  protects the "victim" users submitting evidence.
- Standard GDPR housekeeping still applies regardless of scale: Privacy
  Policy, lawful basis documented per data type, data retention limits,
  right to erasure/access — all already tracked in Phase 3 of the roadmap.
- A formal Data Protection Officer is unlikely to be legally required at
  MVP/community scale (that requirement is triggered by large-scale
  systematic monitoring or large-scale special-category processing), but
  this should be confirmed, not assumed, once real usage numbers exist.

## Updates made to other hand-off docs as a result of this research
- `00-product-plan.md` §5 — cross-referenced this document.
- `03-roadmap.md` Phase 2 — added mandatory face/license-plate blurring.
- `03-roadmap.md` Phase 3 — expanded flag/takedown item into a real
  notice-and-action + published contact + reasons/appeal flow.

## 5. Clarification (2026-09-21): does flagging a *location* as high-risk require naming anyone?
Question raised: if the app never names individuals or companies — only lets
people log "clamped here" reports against a map pin — is the location-level
risk signal itself illegal?

**No.** This is directly comparable to existing, unquestionably lawful
precedents: Glassdoor (anonymous salary/employer reports), Reddit (named or
unnamed complaint threads), and Google Maps reviews / Waze hazard reports
(location-tagged user reports, including for enforcement like police
checkpoints or speed cameras). None of these are illegal, and this app's
"report a location" model is the same category of product.

Why it holds up legally:
- Defamation requires identifying a **legal person** (a company or an
  individual) whose reputation is harmed. A map pin / GPS point is not a
  legal person.
- **Truth is a complete defence.** A user's honest factual account ("my car
  was clamped here on this date") is not an allegation, it's a report.
- One residual nuance still worth designing around: Irish law recognises
  "innuendo" — if a location is so obviously tied to one operator that
  locals would know exactly who's meant without naming them, a court could
  in theory treat that as identifying the company anyway. This doesn't make
  location-flagging illegal; it just means **wording matters**:
  - Prefer neutral, factual, statistical phrasing — e.g. "14 reports of
    clamping at this location in the last 12 months" — over loaded words
    like "trap," "scam," or "high-risk operator."
  - Reports should describe **what happened**, not **why** ("clamped at
    3pm, no visible signage" is safe; "this is a scam" carries more risk).

## 6. Decisions added (2026-09-21): moderation pipeline refinement
Building on the above, two concrete product decisions were made that further
reduce risk and are now the source of truth (supersedes the earlier "light
auto-checks then auto-publish" note in `00-product-plan.md` §2 for images
specifically):
- **Images: human-in-the-loop review before publish.** Every uploaded image
  goes to a lightweight admin/moderator queue; a human confirms it's
  relevant and blurs/redacts anything identifying (faces, plates, people)
  before it goes live. This is stricter than the original "auto-publish"
  plan but removes essentially all of the GDPR/identification risk for
  images, and is cheap to run at community scale (low volume expected).
- **Text: AI-assisted softening + anonymization pass.** Before publish, a
  report's free text is run through an AI rephrasing step that (a) strips
  any names/identifying phrases the user typed in anger, and (b) rewrites
  emotionally charged language into a neutral, factual tone, while
  preserving the substantive facts (time, location, what happened). This is
  a strong, cheap mitigation against both defamation risk (removes stray
  named accusations) and general platform tone/quality. The rephrased
  version — not the raw angry original — is what gets published; the raw
  original can be retained privately (e.g. for the user's own record or
  dispute resolution) but is not shown publicly.
- Net effect: images get **human** review, text gets **AI** review — both
  gate publication, so the location-level system stays purely a "transparency
  signal" (aggregate counts/reports), never an accusation against a party.

## Explicit recommendation
Before any public launch (even soft/invite-only), get a short paid
consultation with an Irish solicitor covering: (1) review of the exact
report/description wording shown to users (disclaimers etc.), (2) sign-off
that the moderation model still qualifies for the Section 27 defence, and
(3) confirmation of current DSA size-based exemption thresholds. This is a
small, bounded cost relative to the risk of getting defamation/DSA wrong.
