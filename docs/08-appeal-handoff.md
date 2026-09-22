# Public clamping appeal guide

## Integration

- Route: `/appeal`, public and server-rendered; no account, form, client state
  or API dependency for guide content.
- Per the owner's updated preference, both "How to appeal" links on the home
  page and footer go directly to
  `https://www.nationaltransport.ie/vehicle-clamping-regulation/`.
  The optional informational `/appeal` guide remains available and links
  back to `/`; it is not an intermediate redirect for the main appeal links.
- Page-local Next Metadata supplies the title and description. Wider SEO
  integration is outside this handoff.
- `src/app/appeal/appeal.module.css` reuses the existing light semantic tokens
  and inherited Geist font. Deadline cards stack below 600px, links have 44px
  minimum targets, and the main landmark supports the shared skip link.
- No shared layout, home page, global styles, environment or roadmap changes.

## Content boundaries

Reviewed date: **22 September 2026**. Based on the official source verified
by the parent:

- https://www.nationaltransport.ie/vehicle-clamping-regulation/
- https://clampingregulation.nationaltransport.ie/appeal
- https://clampingregulation.nationaltransport.ie/complaint

Stage 1 goes to the responsible controller/operator within 60 days of clamping
or relocation; a written response is due within 21 days of receipt. Stage 2
requires completed stage 1 and an application within 30 days of receiving its
decision, with the Letter of Determination and supporting documents. The person
in charge of the vehicle completes the form. No late/no-response exceptions
are inferred. The independent appeals officer decides allowed/not allowed.

The page explicitly limits these procedures to the Republic of Ireland, not
Northern Ireland, and distinguishes clamping appeals from parking fine appeals.
Complaints about conduct/delay/signage are separate and have a 60-day event
deadline; they do not replace appeals. Independent informational guidance only:
not NTA-endorsed, not legal advice, no refund guarantee. Community reporting
neither submits an appeal nor changes deadlines. Personal evidence belongs in
the controller/official form process, not public community notes.

## Focused checks

With the existing development server on port 3001 (or set
`PLAYWRIGHT_BASE_URL` to another running instance):

```powershell
npx eslint src\app\appeal\page.tsx tests\appeal.spec.ts
npx playwright test appeal.spec.ts
```

The tests disable JavaScript to check public server-rendered content, metadata,
60/21/30-day triggers, stage 1 prerequisite, official URLs, privacy and scope
disclaimers. Layout checks cover 320px, 375px and 768px, no horizontal overflow,
44px guide links and keyboard skip-link access. They do not submit official
forms or test physical mobile devices.

Implementation verification: the focused browser suite covers the guide and
direct NTA links. The integrated production build and full TypeScript check
passed after the admin increment; temporary generated-route errors from
parallel implementation are resolved. Live NTA forms are not submitted.
