# MSP CRM — Update & Deploy Runbook

A quick-reference checklist for pushing changes to production, written after a
deploy where the code shipped fine but the database migration silently ran
against the wrong Neon database. Keep this open any time you're deploying.

## This app, at a glance

- **Repo:** `github.com/cwaite3-bit/msp-crm`
- **Production URL:** `msp-crm-seven.vercel.app`
- **Local folder:** `C:\Users\cwaite\OneDrive - Lockdown IT\Toolbox\quoting tool\msp-crm`
- **Hosting:** Vercel, auto-deploys on push to `main`
- **Database:** Postgres via Neon, provisioned through Vercel's Storage integration

If you're not 100% sure you're looking at *this* app's repo/folder/database
and not one of your other two apps, stop and check before running anything
below — see "Juggling three apps" at the bottom.

## Standard update flow (code changes only — no new tables/columns)

1. Work on a feature branch, not directly on `main`.
2. Test locally.
3. Commit and push the branch:
   ```powershell
   git add -A
   git commit -m "..."
   git push -u origin <branch-name>
   ```
4. Open a PR on GitHub (`github.com/cwaite3-bit/msp-crm/compare/main...<branch-name>`) and review the diff.
5. Merge into `main`.
6. Vercel auto-builds and deploys from the push — no CLI command needed. Watch
   the **Deployments** tab in the Vercel dashboard until the new deployment
   shows **Ready**.
7. Hard-refresh the live site (Ctrl+Shift+R) and click through the changed
   area to confirm it actually looks different.

Avoid `vercel --prod` for routine updates — it deploys whatever's sitting in
your local folder directly, bypassing GitHub entirely, and needs `vercel
login` first. The git-based flow above keeps GitHub and production from ever
drifting apart, which the CLI path doesn't guarantee.

## When the update also changes the database schema

This is the step that gets missed, because **a Vercel deploy never touches
the database on its own.** New/changed tables or columns require a manual
migration step, every time, run by you from your own machine.

1. **Get the current PRODUCTION connection string — don't reuse one from an
   old terminal, note, or scrollback.** In the Vercel dashboard: your project
   → **Settings → Environment Variables** → find `DATABASE_URL` → make sure
   you're looking at the value scoped to **Production** (not Preview or
   Development — they can differ). Copy it fresh.

2. Set it in your current PowerShell window — **as its own command, its own
   Enter key press**, never pasted glued onto another command:
   ```powershell
   $env:DATABASE_URL="<paste the production connection string here>"
   ```

3. **Verify it actually took before doing anything else:**
   ```powershell
   echo $env:DATABASE_URL
   ```
   Read the hostname back and confirm it's the one you just copied. This one
   check would have caught the whole incident that prompted this doc —
   don't skip it.

4. Run the migration:
   ```powershell
   npm run db:migrate
   ```

5. If the change also needs new reference/seed data (rate card, catalog
   items, etc.) — safe to re-run any time, it upserts rather than duplicates:
   ```powershell
   npm run db:seed
   ```

6. Reload the live site and open specifically the page(s) that depend on the
   new schema — don't just check the homepage, since unrelated pages will
   look "unchanged" even when the real problem is somewhere else.

7. If anything errors (a generic "This page couldn't load", a 500 in the
   browser): Vercel dashboard → **Deployments** → the current deployment →
   **Logs**. Reload the failing page to trigger a fresh log line, then read
   the actual stack trace/error message rather than guessing — Postgres
   errors like `relation "..." does not exist` tell you exactly what's wrong.

## Pitfalls that caused real problems (keep these in mind)

- PowerShell needs each command on its own line. Pasting `npm run db:seed`
  and `$env:DATABASE_URL="..."` glued together (no line break) makes npm try
  to run a script literally named the whole glued-together string, and fails
  before either half does anything.
- `$env:DATABASE_URL` only lasts for that one PowerShell window — close it,
  and you'll need to set it again before the next migration.
- A `vercel --prod` run that errors with "No existing credentials found"
  means nothing deployed — not even partially. `vercel login` first if you
  ever do need this path.
- Neon/Vercel can hand you more than one connection string tied to the same
  project name (pooled vs. unpooled, or a stale one left over from earlier
  setup) — always re-copy from **Environment Variables → Production**
  immediately before a migration, rather than trusting a string you already
  have sitting somewhere.
- **A clean `npm run db:migrate` with no errors does NOT prove it ran
  against production** — it only proves it ran successfully against
  whatever `DATABASE_URL` was active at the time. Always echo and eyeball
  the hostname first (step 3 above).

## Juggling three apps

IC Peptides, this MSP CRM (Lockdown IT), and ThrustyJet each have their own
repo, Vercel project, and Neon database. Before running any deploy or
migration command, do a 5-second sanity check: which folder's terminal am I
actually in, and does the connection string's hostname plausibly belong to
*this* app? A similar one-page runbook for each of the other two apps would
make that check even faster.
