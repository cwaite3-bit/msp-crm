# Prospect Research ("Research a business") — implementation hand-off

Paste this whole folder into a Claude Code / Cowork session on the msp-crm repo
and say: "Implement IMPLEMENT.md. Reconcile §3 against the real code first."

## 1. What it does

A **Research a business** button on the Prospects page header (next to Import
and New prospect). Staff type a business name (+ city/state, optional website,
optional "what we already know"). The server calls Claude with live web search,
gets back one structured record, runs a live MX lookup on the domain, and checks
for duplicates. Staff review/edit the result, pick **Assign to** (defaults to
themselves), and click **Add as prospect**. The app then opens Prospects
filtered to that staff member and that company, so they see just the new record.

Nothing is written to the database until **Add as prospect** is clicked.

## 2. Files

| File | Role |
|---|---|
| `src/server/prospect-research.ts` | Pure: types, system prompt, JSON parser + format guards, dedupe normalizers, MX classifier, activity-note builder |
| `src/server/actions/prospect-research.ts` | `"use server"`: `researchBusiness`, `saveResearchedProspect`, `listStaffForAssignment` |
| `src/app/(app)/prospects/research-business-dialog.tsx` | The dialog (lookup → researching → review) |
| `drizzle/00XX_add_prospect_research.sql` | Additive columns |

Wire-up: render `<ResearchBusinessDialog />` in the Prospects page header, and
add `export const maxDuration = 300;` to `src/app/(app)/prospects/page.tsx`
(a lookup runs 30–90 s; Server Actions inherit the page's duration limit).

## 3. Reconcile against the live repo BEFORE merging

These files were written from the architecture doc, which is behind the repo
(Territory owners, Confidence, archive, and unified Leads/Prospects aren't in it).
Check and adjust each:

- **Owner column** — Territory "Assign by state" already stores an owner on
  `customers`. Use that exact column instead of `ownerUserId`, and make sure the
  territory rule does **not** overwrite a manually chosen owner on insert.
- **Confidence column** — use the existing one behind the Confidence badge.
- **Prospects URL params** — use the filter bar's real param names for staff
  owner and search in place of `?owner=` / `?q=`. Optionally honor `?highlight=<id>`
  to ring the new row for a few seconds.
- **customers fields** — `website`, `address/city/state/zip`, `leadSource`,
  `archivedAt`: drop any `ADD COLUMN` in the migration that already exists.
  If Prospect ID from the spreadsheet import is already stored somewhere, reuse
  that column instead of adding `prospect_external_id`.
- **contacts / notes shape** — `name` vs `firstName/lastName`, `isPrimary`,
  note `type` enum value, `authorId` column name.
- **Auth / db imports** — `requireUser`, `db`, schema import paths; `users.active`.
- **UI primitives** — `Textarea`, `Label`, `Select` paths/props in
  `src/components/ui/`; toast library if you'd rather toast than inline errors.
- **Model** — share the constant/env var `ai-review.ts` uses.

## 4. Field mapping (spreadsheet header → where it lands)

| Spreadsheet header | Stored in |
|---|---|
| Prospect ID | `prospect_external_id` — `RS-0001…` (own prefix, never collides with `QC-` sweep IDs) |
| Company Name, Address, City, State, ZIP, Industry, Main Phone, Website, Public Email | matching `customers` columns |
| Confidence | existing Confidence column (badge) |
| Decision Maker, Title | primary `contacts` row |
| Employee Estimate, Employee Evidence, Business / IT Signals, Security / Complexity Signals, Decision-Maker Notes, Qualification Notes, Primary Source, Email/Phone Source, Email Status, Outreach Status | activity note + `research` jsonb |
| (blank column T in the sheet) | ignored |

**Added fields** (all in the activity note + `research` jsonb): email provider
from a live MX lookup (Microsoft 365 / Google Workspace / behind Proofpoint etc.),
existing IT provider + evidence, compliance frameworks, LinkedIn + social links,
year founded, ownership type, location count + other locations, hours, Google
rating/reviews, IT hiring signals, recent news, additional contacts (saved as
extra `contacts` rows), talking points, cited source URLs, last-researched date.
Stage defaults to `NEW`, lead source to `Prospect Research`.

Optional follow-up: surface `emailProvider` and `existingItProvider` as small
badges on the Prospects row, and add a **Re-research** action on the customer
detail page that re-runs `researchBusiness` and appends a new dated note.

## 5. Guardrails built in

- Public business info only; the prompt forbids personal addresses/cells/socials.
- Nulls instead of guesses; format guards swap a phone that lands in the Website
  field back to Main Phone (a real problem in rows like QC-0002 of the ChatGPT sheet).
- Duplicate check by normalized name, website domain, or phone; save is blocked
  unless staff tick "different business, add it anyway". Checked again at save time.
- `pause_turn` continuation and `max_tokens` handled as a clear error, same
  pattern as the AI quote review.
- Requires `ANTHROPIC_API_KEY` (already needed by AI quote review). Missing key →
  clear "not configured yet" error; nothing else affected.

## 6. Cost

Up to 10 web searches ($0.10 max in search fees) plus one Opus-class call with a
long research transcript. Expect well under a dollar per lookup; switch
`ANTHROPIC_MODEL` to a Sonnet model to cut that further at some quality cost.

## 7. Test plan

1. `npx tsc --noEmit` clean.
2. Research "Queen Creek Veterinary Clinic", Queen Creek AZ → should flag a
   duplicate (it's in the imported sheet). Confirm save is blocked until ticked.
3. Research a business not in the CRM → review, change owner to another staff
   member, Add → lands on Prospects filtered to that owner + company, one row,
   Confidence badge set, activity note contains every section and source URLs,
   decision maker is the primary contact.
4. Unset `ANTHROPIC_API_KEY` locally → clear error, dialog stays usable.
5. Deploy with `C:\Scripts\MSP\deploy.bat` (migration runs automatically), then
   repeat step 3 on production.
