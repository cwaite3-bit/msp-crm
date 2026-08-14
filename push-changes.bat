@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ================================================
echo   MSP CRM - push changes to GitHub
echo ================================================
echo Folder: %cd%
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo This folder does not look like a git repo. Aborting.
    echo Make sure this script lives inside the msp-crm folder itself.
    pause
    exit /b 1
)

echo Staging all changes...
git add -A

set /p msg="Commit message (press Enter to use a default): "
if "%msg%"=="" set msg=Update %date% %time%

echo.
echo Committing...
git commit -m "%msg%"
if errorlevel 1 (
    echo   (Nothing new to commit - that's fine, continuing.)
)

echo.
echo Pulling any changes from GitHub first...
git pull --no-edit
if errorlevel 1 (
    echo.
    echo   Pull failed - you may have a merge conflict that needs manual attention.
    echo   Nothing was pushed. Scroll up to see the error.
    pause
    exit /b 1
)

echo.
echo Pushing to GitHub...
git push
if errorlevel 1 (
    echo.
    echo   Push failed. Scroll up to see the error.
    pause
    exit /b 1
)

echo.
echo ================================================
echo   Done! Vercel will auto-redeploy shortly.
echo ================================================
pause
