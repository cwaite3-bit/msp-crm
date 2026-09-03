<#
.SYNOPSIS
  Commit + push msp-crm to GitHub main, then (optionally) trigger a direct
  Vercel production deploy as well.

.DESCRIPTION
  This project auto-deploys to Vercel whenever `main` is pushed on GitHub,
  so the git push below is what actually ships your change - that's the
  main event. Adding an explicit `vercel --prod` after it is optional
  (-AlsoVercelDeploy): it uploads your local folder straight to production,
  bypassing GitHub, and creates a SECOND deployment for the same commit
  alongside the one the git push already triggered. It's not harmful, just
  redundant - the main reason to reach for it is if the GitHub integration
  ever stops auto-deploying and you need a way to force a deploy anyway.

  Database migrations are NOT run unless you explicitly pass -Migrate.
  Even then, this script does not just trust whatever $env:DATABASE_URL
  happens to be set to - it prints the exact host it's about to run
  `npm run db:migrate` against and makes you type YES after actually
  looking at it. That "eyeball it first" check is what would have caught
  the original "migrated the wrong database" mess this script exists to
  prevent - skipping the check would just make the same mistake easier
  to make again, faster.

.PARAMETER Message
  Commit message. Required.

.PARAMETER AlsoVercelDeploy
  Switch. If passed, also runs `vercel --prod --yes` after the git push.
  Requires `vercel login` to have been run at least once already.

.PARAMETER Migrate
  Switch. If passed, runs `npm run db:migrate` against $env:DATABASE_URL
  after the deploy step - but only after printing the exact host from
  that connection string and requiring you to type YES to confirm it's
  really the production database. Only use this on a push that actually
  changes the schema.

.PARAMETER Seed
  Switch. Only has an effect combined with -Migrate. After a confirmed
  migrate, also runs `npm run db:seed` (safe to re-run - it upserts).

.EXAMPLE
  .\scripts\deploy.ps1 -Message "Fix catalog tier display"

.EXAMPLE
  .\scripts\deploy.ps1 -Message "Fix catalog tier display" -AlsoVercelDeploy

.EXAMPLE
  $env:DATABASE_URL = "<production connection string>"
  .\scripts\deploy.ps1 -Message "Add app_settings table" -Migrate -Seed
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$Message,

    [switch]$AlsoVercelDeploy,

    [switch]$Migrate,

    [switch]$Seed
)

$ErrorActionPreference = "Stop"

# Always run from the repo root, regardless of where the script was invoked
# from - this file lives in scripts/, so the repo root is one level up.
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Fail($msg) {
    Write-Host $msg -ForegroundColor Red
    exit 1
}

Write-Host "== msp-crm deploy ==" -ForegroundColor Cyan
Write-Host "Repo: $repoRoot"

if (-not (Test-Path ".git")) {
    Fail "No .git folder here - this doesn't look like the msp-crm repo root. Aborting."
}

# --- 1. Show current state before touching anything -----------------------
$branch = git branch --show-current
Write-Host "Current branch: $branch"
git status --short

if ($branch -ne "main") {
    $confirm = Read-Host "You're on '$branch', not 'main'. Commit + push this branch anyway? (y/N)"
    if ($confirm -ne "y") { Fail "Aborted - nothing was committed or pushed." }
}

# --- 2. Stage + commit (only if there's something to commit) --------------
git add -A
$staged = git diff --cached --name-only
if (-not $staged) {
    Write-Host "Nothing staged - working tree already matches the last commit. Skipping commit." -ForegroundColor Yellow
} else {
    Write-Host "`nStaged files:" -ForegroundColor Cyan
    $staged | ForEach-Object { Write-Host "  $_" }
    git commit -m $Message
}

# --- 3. Pull first so a rejected push doesn't leave you guessing ----------
Write-Host "`nPulling latest $branch before pushing..." -ForegroundColor Cyan
git pull --ff-only origin $branch
if ($LASTEXITCODE -ne 0) {
    Fail "git pull --ff-only failed - you likely have local commits that diverge from origin/$branch. Resolve manually (git status / git log) before re-running this script."
}

# --- 4. Push ---------------------------------------------------------------
git push origin $branch
if ($LASTEXITCODE -ne 0) {
    Fail "git push failed - see the error above."
}

$commitHash = git rev-parse --short HEAD
Write-Host "`nPushed commit $commitHash to origin/$branch." -ForegroundColor Green

if ($branch -eq "main") {
    Write-Host "Vercel's GitHub integration should now be building this automatically." -ForegroundColor Cyan
    Write-Host "Watch it at: https://vercel.com/dashboard (your project -> Deployments)" -ForegroundColor Cyan
} else {
    Write-Host "You pushed a non-main branch - this alone will NOT deploy to production." -ForegroundColor Yellow
    Write-Host "Open a PR and merge to main (or re-run this script from main) to actually deploy." -ForegroundColor Yellow
}

# --- 5. Optional: also trigger a direct Vercel CLI deploy -----------------
if ($AlsoVercelDeploy) {
    Write-Host "`n-AlsoVercelDeploy was passed - checking Vercel CLI login..." -ForegroundColor Cyan
    vercel whoami *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail "Not logged in to the Vercel CLI. Run 'vercel login' once, then re-run this script with -AlsoVercelDeploy."
    }
    Write-Host "Running 'vercel --prod --yes' (deploys the local folder directly, on top of the git-triggered deploy above)..." -ForegroundColor Cyan
    vercel --prod --yes
}

# --- 6. Optional: migrate, with a mandatory eyeball-the-host check --------
if ($Migrate) {
    Write-Host "`n-Migrate was passed." -ForegroundColor Cyan

    if (-not $env:DATABASE_URL) {
        Fail "`$env:DATABASE_URL is not set in this window. Set it to the PRODUCTION connection string first (see deployment-runbook.md), then re-run with -Migrate."
    }

    $dbHostName = "(could not parse a host out of DATABASE_URL - look at the full string below)"
    if ($env:DATABASE_URL -match '@([^/]+)/') {
        $dbHostName = $Matches[1]
    }

    Write-Host "`nAbout to run 'npm run db:migrate' against:" -ForegroundColor Yellow
    Write-Host "  host: $dbHostName" -ForegroundColor Yellow
    Write-Host "  full DATABASE_URL: $env:DATABASE_URL"
    $dbConfirm = Read-Host "`nIs that host really your PRODUCTION database? Type YES (all caps) to proceed"

    if ($dbConfirm -ne "YES") {
        Write-Host "Skipped migration - typed '$dbConfirm', not 'YES'." -ForegroundColor Yellow
    } else {
        npm run db:migrate
        if ($LASTEXITCODE -ne 0) {
            Fail "db:migrate failed - see the error above. Nothing further was run."
        }
        Write-Host "Migration applied." -ForegroundColor Green

        if ($Seed) {
            npm run db:seed
            if ($LASTEXITCODE -ne 0) {
                Fail "db:seed failed - see the error above."
            }
            Write-Host "Seed applied." -ForegroundColor Green
        }
    }
} else {
    Write-Host "`nNote: -Migrate was not passed. If this push included a database schema change, that still needs 'npm run db:migrate' - either re-run this script with -Migrate, or do it manually per deployment-runbook.md." -ForegroundColor Yellow
}

Write-Host "`nDone. Once the deployment shows Ready, hard-refresh https://msp-crm-seven.vercel.app and check the changed area." -ForegroundColor Cyan
