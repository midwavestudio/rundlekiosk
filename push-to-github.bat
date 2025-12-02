@echo off
echo ========================================
echo   Push Rundle Kiosk to GitHub
echo ========================================
echo.
echo Step 1: Create repository on GitHub
echo   1. Go to: https://github.com/new
echo   2. Repository name: rundlekiosk
echo   3. Choose Private or Public
echo   4. DO NOT initialize with README
echo   5. Click Create repository
echo.
echo Step 2: Enter your GitHub username below
echo.
set /p GITHUB_USER="Enter your GitHub username: "

if "%GITHUB_USER%"=="" (
    echo Error: Username is required
    pause
    exit /b 1
)

echo.
echo.
echo Checking for existing remote...
git remote remove origin 2>nul

echo.
echo Adding remote: https://github.com/%GITHUB_USER%/rundlekiosk.git
git remote add origin https://github.com/%GITHUB_USER%/rundlekiosk.git

if errorlevel 1 (
    echo.
    echo Error adding remote. Please check your username and try again.
    pause
    exit /b 1
)

echo.
echo Pushing to GitHub...
git push -u origin main

if errorlevel 1 (
    echo.
    echo ========================================
    echo   Push failed!
    echo ========================================
    echo.
    echo Possible reasons:
    echo   1. Repository doesn't exist on GitHub yet
    echo   2. Authentication failed
    echo   3. Network issue
    echo.
    echo Make sure you:
    echo   1. Created the repository on GitHub first
    echo   2. Have proper authentication set up
    echo   3. Are using a Personal Access Token (not password)
    echo.
) else (
    echo.
    echo ========================================
    echo   SUCCESS! Pushed to GitHub!
    echo ========================================
    echo.
    echo View your repository at:
    echo https://github.com/%GITHUB_USER%/rundlekiosk
    echo.
)

pause
