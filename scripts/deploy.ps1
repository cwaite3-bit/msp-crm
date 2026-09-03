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

  This intentionally does NOT run database migrations. Migrations are
  their own manual step, run with a fresh, verified DATABASE_URL - see
  deployment-runbook.md. Baking that into a script that runs on every
  push is exactly the kind of automation that caused the original
  "migrated the wrong database" mess this script exists to prevent.

.PARAMETER Message
  Commit message. Required.

.PARAMETER AlsoVercelDeploy
  Switch. If passed, also runs `vercel --prod --yes` after the git push.
  Requires `vercel login` to have been run at least once already.

.EXAMPLE
  .\scripts\deploy.ps1 -Message "Fix catalog tier display"

.EXAMPLE
  .\scripts\deploy.ps1 -Message "Fix catalog tier display" -AlsoVercelDeploy
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$Message,

    [switch]$AlsoVercelDeploy
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

Write-Host "`nDone. Once the deployment shows Ready, hard-refresh https://msp-crm-seven.vercel.app and check the changed area." -ForegroundColor Cyan
Write-Host "If this push included a database schema change, that still needs a separate, manual 'npm run db:migrate' - see deployment-runbook.md. This script does not run it for you." -ForegroundColor Yellow
