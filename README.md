# MSP CRM & Quoting

A lightweight CRM (customers, contacts, activity log) plus a full IT-MSP quoting
tool that pushes accepted quotes into QuickBooks Online as invoices. Built to
run as its own Vercel project — independent of any other app you host on the
same Vercel account — with Postgres (Neon) as the database.

Ticketing/PSA is intentionally out of scope: this app is meant to be the
system of record for customers and quotes, with a separate PSA tool
(ConnectWise, Halo, Autotask, etc.) pulling customer records from here.

## Stack

- **Next.js 16** (App Router, Turbopack, TypeScript)
- **Drizzle ORM** over **Postgres** — chosen over Prisma specifically because
  it has no native binary engine to download/bundle, which keeps Vercel
  serverless function cold starts small and sidesteps a class of "engine
  binary blocked by network policy" failures entirely.
- **NextAuth (Auth.js) v5**, credentials provider, JWT sessions — simple
  internal staff login, no external IdP needed for a single-company tool.
- **QuickBooks Online API** via hand-rolled OAuth2 + REST client
  (`src/server/quickbooks/`) — no heavy SDK dependency.
- Hand-built UI primitives in `src/components/ui/` (button, input, dialog,
  select, table, tabs, etc.) in the shadcn/ui style — built by hand because
  the shadcn CLI's registry wasn't reachable in the sandbox this was built
  in; functionally equivalent, and you can adopt the real shadcn CLI later
  since the component API matches.

## Data model

See `src/server/db/schema.ts` for the full source of truth. Summary:

- **users** — internal staff logins (ADMIN / STAFF roles)
- **customers**, **contacts**, **notes** — the CRM: one company record per
  customer, multiple contacts, a timestamped activity log (notes/calls/
  emails/meetings)
- **product_categories**, **service_tiers**, **products**,
  **product_tier_prices** — the catalog. Every product belongs to a
  category (Support, Network, Services, ...) and can optionally have a
  different price per service tier (e.g. "User support" costs more at the
  "Best" tier than "Good"). Products can be created from the Catalog admin
  page *or* inline from the quote builder ("add on the fly") — both paths
  hit the same `createProduct` / `quickCreateProduct` server actions.
- **quotes**, **quote_line_items**, **quote_events** — a quote belongs to a
  customer (and optionally a specific contact), has a service tier, and a
  list of line items. Line items snapshot the product's name/unit/price at
  the time they were added, so editing the catalog later never changes the
  numbers on a quote that's already gone out. `quote_events` is an audit
  trail (created/sent/viewed/accepted/rejected/QuickBooks-synced).
- **quickbooks_connections** — single-row OAuth token storage for the one
  QuickBooks company this app is connected to.

## How quoting works

1. Staff create a quote against a customer, pick a service tier.
2. Line items are added either by picking an existing catalog product (its
   price resolves against the quote's service tier automatically) or by
   creating a brand-new product on the spot via the "Add on the fly" tab —
   optionally saving it to the catalog for reuse on future quotes.
3. Quantity and unit price are editable per line for one-off negotiation
   without touching the catalog default.
4. `src/server/pricing.ts` is the single source of truth for totals
   (monthly subtotal/total, one-time subtotal/total, discount, tax) — both
   the staff builder and the client-facing report import it, so the numbers
   can never drift between what staff sees and what the client sees.
5. Marking a quote "sent" gives it a public link (`/q/[token]`) — no login
   required. That page is the client-facing report: line items grouped by
   category, a prominent monthly total, notes, and Accept/Decline buttons.
   Accepting requires typing a name (a lightweight acknowledgment, **not** a
   legally-binding e-signature — see Limitations below).
6. Once a quote is `ACCEPTED`, a "Send to QuickBooks" button appears. That
   creates (or reuses) a matching QuickBooks Customer and Item records, then
   creates an Invoice with one line per quote line item.

## Local development

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL at minimum
npm run db:generate    # only needed after changing schema.ts
npm run db:migrate     # applies drizzle/*.sql to your database
npm run db:seed        # creates an admin user + starter MSP catalog
npm run dev
```

The seed script prints the admin login it creates
(`admin@example.com` / a generated password unless you set
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` first). **Change that password**
(or delete the seeded admin and create a real one from Settings) before
using this for real data.

`scripts/smoke-test.mjs` and `scripts/screenshot.mjs` are Playwright scripts
that exercise the whole app end-to-end (login → create customer → build a
quote → accept it as the client → catalog/settings). Useful as a regression
check after changes: `node scripts/smoke-test.mjs` against a running
`npm run start`.

## Deploying to Vercel (as its own project)

Vercel bills per account/seat, not per project, so this runs alongside any
other app on the same account at no extra hosting cost.

1. Push this repo to GitHub (or your git host of choice).
2. In the Vercel dashboard: **Add New → Project**, import the repo. This is
   a separate project from your other app — separate URL, separate env
   vars, separate deploys.
3. **Storage → Create Database → Postgres** on the new project. This
   provisions a Neon-backed Postgres database and auto-injects
   `DATABASE_URL` into the project's environment variables.
4. Add the remaining environment variables (Project Settings →
   Environment Variables), matching `.env.example`:
   - `AUTH_SECRET` — generate with `npx auth secret`
   - `NEXTAUTH_URL` — your production URL, e.g. `https://your-app.vercel.app`
   - `APP_BASE_URL` — same value, used for building shareable quote links
     and OAuth redirects server-side
   - `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT`,
     `QBO_REDIRECT_URI` — see QuickBooks setup below
5. Deploy. Then run the migration + seed once against the production
   database (from your machine, with `DATABASE_URL` pointed at the Neon
   connection string from the Vercel dashboard):
   ```bash
   DATABASE_URL="<neon connection string>" npm run db:migrate
   DATABASE_URL="<neon connection string>" npm run db:seed
   ```
6. Log in with the seeded admin, change the password (or create a proper
   admin user from Settings and deactivate the seed one).

## QuickBooks Online setup

1. Create an app at [developer.intuit.com](https://developer.intuit.com/app/developer/myapps)
   with the **Accounting** scope enabled.
2. Add `https://your-app.vercel.app/api/quickbooks/callback` as a redirect
   URI in the Intuit app settings, and set `QBO_REDIRECT_URI` to match
   exactly.
3. Copy the app's Client ID / Client Secret into `QBO_CLIENT_ID` /
   `QBO_CLIENT_SECRET`. Use the **sandbox** keys and
   `QBO_ENVIRONMENT=sandbox` first to test the full flow risk-free against a
   fake QuickBooks company; switch to production keys when ready.
4. As an admin user, go to **Settings → QuickBooks Online → Connect to
   QuickBooks** and complete the Intuit consent screen.
5. The first time a product/service is invoiced, this app needs an Income
   account to attach new QuickBooks "Items" to. It auto-picks the first
   Income account it finds in your QuickBooks company. To pin a specific
   one instead, set `QBO_INCOME_ACCOUNT_ID` to that account's QuickBooks ID.

## Known limitations / good next steps

- **First invoice only.** Sending a quote to QuickBooks creates one invoice
  covering everything currently on the quote (one-time fees + first month
  of recurring services). It does **not** set up recurring monthly billing
  in QuickBooks automatically — QuickBooks' recurring-transactions feature
  isn't exposed on the standard Accounting API scope. Two reasonable paths
  forward: (a) use QuickBooks' own "Make recurring" feature on the first
  invoice it creates, or (b) add a scheduled task (Vercel Cron) that calls
  a new endpoint to re-invoice every ACCEPTED quote's recurring line items
  monthly. Neither is implemented yet.
- **Acceptance is not a legal e-signature.** Typing a name on the public
  quote page timestamps an acceptance with the IP address, which is fine as
  a lightweight "yes, go ahead" but isn't DocuSign-grade proof. If you need
  that, swap in a real e-sign provider (Dropbox Sign, DocuSign) on the
  accept flow.
- **Single company only, by design** — there's no tenant isolation, which
  keeps the data model and auth simple. Don't repurpose this for multiple
  separate MSP businesses without adding that.
- No email sending yet (`resend` is installed but unwired) — right now
  staff copy the client link and send it manually. Wiring up "Send quote"
  to actually email the link is a natural next step.
