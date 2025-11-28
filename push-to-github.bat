@echo off
echo ========================================
echo   Push Rundle Kiosk to GitHub
echo ========================================
echo.
echo Step 1: Create a repository on GitHub named "rundlekiosk"
echo         Go to: https://github.com/new
echo.
echo Step 2: After creating the repo, run these commands:
echo.
echo    git remote add origin https://github.com/YOUR_USERNAME/rundlekiosk.git
echo    git push -u origin main
echo.
echo Replace YOUR_USERNAME with your GitHub username!
echo.
echo Current git status:
git status
echo.
echo Ready to push? Make sure you've:
echo   1. Created the GitHub repository
echo   2. Replaced YOUR_USERNAME in the commands above
echo.
pause


