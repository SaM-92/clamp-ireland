# Approved-note community feedback

## Scope and integration status

Implemented data/API, UI, preview storage and tests. Mounted beneath each
`LocationNotes` entry alongside the separate nearby summary, with one
list-level viewer hook. HomeClient's Reset preview clears votes and reports.
No changes to layout, global CSS, environment, packages, scoring, report totals,
summaries or source selection. No live Supabase migration was run.

The agreed policy is one current vote per confirmed account per approved note:
**Agreed** or **Disagreed**. Selecting the same choice removes it; selecting the
other switches it. Report authors can vote on their own notes. Counts are public;
the viewer's own selection is private. This is community feedback, not proof or
an additional clamping-risk signal.

## Database and repository boundary

`supabase/migrations/0005_report_votes.sql` adds `report_votes` with primary key
`(report_id, user_id)`, a checked agree/disagree value, and cascading references to
reports and profiles (profiles already cascade from auth users).

There are no browser table grants or RLS mutation policies. Even `service_role`
has no direct table access: server-only security-definer RPCs perform the bounded
operations. RPCs use an empty search path and explicitly qualified relations.
They additionally require an email-confirmed auth user; the API first resolves
that user with the existing `getUserFromRequest`, never from request JSON.

`set_report_vote` locks the report row, verifies published + reviewed +
nonremoved status, and upserts or deletes the requested user's row. It returns
the resulting counts and own selection. The operation is a **desired-state set**,
not a database toggle: retrying agree/disagree/null cannot double-count. Counts
are derived from rows, not read/increment/write counters. Moderation and voting
serialize on the report row. A no-longer-public report returns unavailable and
does not allow a new vote, switch or removal through the voting endpoint.

`get_report_votes_for_user` reads up to 50 IDs in one service-only call, returning
only that user's selection for currently eligible reports, including null votes.
Hidden/nonexistent reports are omitted rather than leaking their status.

`reports_public` retains its original six columns in their original order
(`id, location_id, reporter_type, description, incident_date, created_at`) and
the same published/reviewed/nonremoved filter. Only `agree_count` and
`disagree_count` are appended. It never exposes voter IDs or private originals.
Removing/requeueing a report immediately hides its counts. Existing vote rows
are retained through moderation; republishing restores their counts. Deleting a
report/account cascades the relevant votes.

The public notes endpoint fetches these counts with its existing one-query,
latest-50 projection. `PublicReport.voteCounts` is optional only for compatibility
with browser-preview notes and existing callers; live successful responses
always include validated `{ agreeCount, disagreeCount }`. Missing/invalid database
counts are an explicit error, never fabricated zeroes. Apply migration 0005 before
serving this code against a configured database, otherwise that public read will
fail visibly.

Only `src/modules/votes/server/repository.ts` knows the vote-storage RPCs. Its
typed `setReportVote` and `getOwnReportVotes` operations are the swappable adapter
boundary for any future backend decision. No Azure migration is assumed.

## HTTP contract

| Request | Body / query | Response |
| --- | --- | --- |
| `GET /api/report-votes` | `reportIds=UUID,UUID` (1-50 unique IDs) | `{ votes: [{ reportId, vote: "agree" \| "disagree" \| null }] }` |
| `PUT /api/report-votes/:reportId` | `{ vote: "agree" \| "disagree" \| null }` | `{ reportId, vote, agreeCount, disagreeCount }` |

Both require the confirmed account's `Authorization: Bearer <access token>`.
All success and handled error responses have `Cache-Control: private, no-store`
and `Vary: Authorization`. Invalid input returns 400, absent/unconfirmed/expired
auth 401, unavailable reports 404, storage failures 500. Unknown JSON properties
such as `userId` are rejected. A `userId` query value has no authority; only the
verified request user is ever passed to storage. There is no anonymous/preview
write mode on these endpoints.

The frontend API validates responses, rejects identifying/unexpected projection
fields and never treats network/storage errors as successful votes. Vote state
and tokens are not persisted in localStorage for real accounts.

## Current mount contract

Imports:

```tsx
import { ReportVotes } from "@/modules/votes/components/ReportVotes";
import { useReportVoteViewer } from "@/modules/votes/useReportVoteViewer";
import type { VoteSnapshot } from "@/modules/votes/types";
```

Call the hook **once at the notes-list level**, not once per note. Using the
existing `notes` state and `preview = previewNotes !== null`:

```tsx
const voting = useReportVoteViewer(preview ? [] : notes.map((note) => note.id), preview);

function feedbackSaved(snapshot: VoteSnapshot) {
  voting.recordVote(snapshot);
  setNotes((current) => current.map((note) => note.id === snapshot.reportId
    ? { ...note, voteCounts: {
        agreeCount: snapshot.agreeCount,
        disagreeCount: snapshot.disagreeCount,
      } }
    : note));
}
```

Inside each existing approved note's `<li>`, after its text:

```tsx
{preview ? (
  <ReportVotes
    reportId={note.id}
    preview
    counts={{ agreeCount: 0, disagreeCount: 0 }}
  />
) : note.voteCounts ? (
  <ReportVotes
    reportId={note.id}
    counts={note.voteCounts}
    viewer={voting.viewerFor(note.id)}
    onChange={feedbackSaved}
    onRetry={voting.retry}
  />
) : (
  <p role="alert">Feedback counts are unavailable. Close and reopen notes to retry.</p>
)}
```

The hook resolves the access token once and batches selections, subscribes once
to auth changes, aborts stale reads, and clears prior account selections on
sign-out/account changes. It does not fetch in preview or for an empty list. Call
`voting.retry()` when intentionally refreshing the same report list if fresh own
selections are needed; this is not a realtime cross-device subscription.

`ReportVotes` keeps local successful snapshots immediately, including when the
parent does not supply `onChange`. The callback is recommended so list state
retains updated public counts. It never fetches an individual own-vote on mount.
Its `viewer` prop is a discriminated loading/signed-out/error/ready state; ready
includes only the access token and this note's vote. Preview mode cannot accept
a viewer. An auth identity change remounts the controls and ignores obsolete
in-flight results.

Buttons have 44px minimum targets, `aria-pressed`, disabled busy states, visible
focus, error alerts and a status announcement. Anonymous viewers still see
public counts and a confirmed-account sign-in prompt. Styling is a CSS module
using existing light tokens/Geist. The root is a section with group semantics to
avoid the existing `.public-notes li > div` metadata-row styles. No user HTML is
rendered.

## Local preview and reset integration

Preview simulates **one browser voter**, without identity, login or backend
requests. It uses separate storage `clamp-local-preview-votes-v1`, a Zod-validated
UUID-to-vote map. Counts are 0 or 1; no pretend extra voters are added. It does not
read/write the report scoring fields or the report storage key. Storage/JSON/
validation failures are visible and do not silently erase data. The component
responds to reset events and other-tab storage events; this lightweight demo is
not a substitute for the database's transactional multi-user guarantees.

The existing Reset preview handler calls:

```tsx
import { clearPreviewVotes } from "@/modules/votes/preview";

// Within the reset handler's existing error handling:
clearPreviewVotes();
// Keep the existing report reset behavior too.
```

The helper removes only the vote key and emits the preview-votes change event,
so mounted controls reset immediately. Surface any storage exception using the
existing reset error handling. Real voting is never enabled by preview state.

## Verification and remaining checks

```powershell
npx playwright test votes
npx eslint src\modules\votes src\app\api\report-votes src\modules\reports\types.ts "src\app\api\locations\[id]\reports\route.ts" tests\votes-browser.spec.ts tests\votes-policy.spec.ts tests\votes-runtime.spec.ts
npx tsc --noEmit --incremental false
```

- PGlite executes the actual migration against a minimal auth/report fixture:
  safe public projection/order/filter, service-only RPCs, denied raw access,
  unique/set/switch/remove semantics, confirmation checks, hidden-note rejection,
  self-voting, cascades, and unchanged report/location fields.
- Server tests execute the real routes, auth helper and repository with only
  the Supabase transport mocked. No cloud/database network is permitted. They
  cover invalid input and user-ID injection, private headers, one batch for 50
  notes, strict projections, and failure statuses.
- Browser tests bundle the actual React component/hook with the installed
  Next/TypeScript tooling in an isolated harness, with the existing global CSS.
  They cover 375px layout, keyboard/toggle/switch/remove, loading/error/auth states,
  ignored stale results, single-batch reads, preview persistence/reset/corruption,
  and unchanged preview risk scores/report counts.
- `votes-integration.spec.ts` exercises the actual homepage and note dialog at
  320/375/430px, touch and keyboard voting, landscape focus visibility,
  reload persistence, full Reset preview, corrupt/blocked storage and public
  production counts with disabled anonymous controls. Missing counts are
  explicitly unavailable rather than fabricated zeroes.

The component is integrated into the real notes dialog; integration coverage
exercises local persistence/reset and production anonymous counts/sign-in.
PGlite is
not a real multi-connection Postgres lock-contention test or a live Supabase
permissions deployment. No physical-device, cloud migration or real-account
end-to-end verification was performed.

Completed locally: all **14 voting tests** plus the existing public-notes privacy
regression passed (**15 total**). Focused ESLint and repository-wide
`tsc --noEmit --incremental false` both passed.

Parent integration additionally passed the production build and full ESLint.
The focused votes/mobile/public-notes run passed 23 checks with one
production-only skip; the affected production-mode regression run passed
64 checks with 11 development-only skips. Model calls remained mocked/disabled,
and no live backend or cloud resources were configured. The temporary production
server was separate from the development preview.
