# Scoring Algorithm (v1 — implemented)

Depends on: `00-product-plan.md` §3, `02-data-model.md`.
Implemented in: `src/modules/scoring/` (`constants.ts`, `calculateRiskScore.ts`,
`riskLevel.ts`, `recomputeLocationScore.ts`). This doc documents the code —
if they ever disagree, the code is what actually runs; update this file to
match, not the other way round.

## 1. Inputs
Only reports that are `moderation_status = 'published'` and `is_removed =
false` are counted (`recomputeLocationScore.ts`). A report contributes:
- `reporterType`: `victim` | `neighbour` | `witness`
- `hasImage`: boolean
- `createdAt`: timestamp

## 2. Base weight per report
Two axes — who's reporting, and whether they backed it with a photo — set a
base point value (`constants.ts`):

| Reporter type | With photo | Without photo |
|---|---|---|
| victim | 10 | 6 |
| neighbour | 5 | 3 |
| witness | 4 | 2 |

Rationale: a victim's own account of being clamped is the strongest signal
a location is genuinely risky; a witness account is corroborating but
weaker. A photo roughly doubles a report's weight within its own category,
reflecting stronger evidence — but never crosses into a higher reporter
tier (e.g. a witness-with-photo, 4 points, still counts for less than a
neighbour-without-photo, 3 points, is close but a victim-without-photo, 6
points, always outweighs it).

## 3. Time decay
Reports lose relevance over time — a clamping company's behaviour today
matters more than a report from three years ago — but old reports never
fully vanish (locations don't magically become "safe" the moment reports
age out). Exponential decay with a 180-day half-life:

```
decay = 0.5 ^ (age_in_days / 180)
```

A report is worth 50% of its base weight after 180 days, 25% after 360
days, and asymptotically approaches (but never reaches) zero.

## 4. Aggregation + saturation curve
All decayed weights for a location's published reports are summed into a
raw score, then passed through a saturating curve so a handful of reports
move the needle quickly, but no number of reports can push the score past
100 (keeps the 0–100 range meaningful and comparable across locations):

```
risk_score = 100 * (1 - e^(-raw / 25))
```

`25` (`SATURATION_K`) sets how quickly the curve saturates — it's the raw
score at which a location reaches ~63% of the maximum. Worked examples:

| Raw score | risk_score |
|---|---|
| 0 | 0 |
| 6 (one victim report, no photo, fresh) | ~21.3 |
| 10 (one victim report, with photo, fresh) | ~32.9 |
| 25 | ~63.2 |
| 50 | ~86.5 |
| 100 | ~98.2 |

## 5. Risk level thresholds
The numeric `risk_score` is bucketed into a human-readable `risk_level` for
map pin colouring and copy (`riskLevel.ts`):

| risk_score | risk_level |
|---|---|
| < 20 | low |
| 20 – 49.99 | medium |
| ≥ 50 | high |

## 6. When it recomputes
`recomputeLocationScore(locationId)` is called synchronously today whenever
a report's moderation status changes to/from `published` (see
`src/modules/reports/server/repository.ts` and the moderation API route).
There is no scheduled/cron recompute yet — because the formula only depends
on report age (which changes continuously) and moderation state (which
changes on explicit actions), a location's score technically drifts slowly
stale between recomputes as reports age. A scheduled recompute (e.g. daily,
via a Supabase Edge Function or Vercel Cron) is a tracked roadmap item, not
yet implemented — see `05-roadmap.md`.

## 7. Anti-brigading
Not yet implemented. The current formula has no per-user cap, so in theory
one account submitting many reports for the same location could inflate its
score. Tracked as a roadmap item (e.g. cap contribution per user per
location, or require distinct accounts above a threshold before a location
can reach "high").
