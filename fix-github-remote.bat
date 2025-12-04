@echo off
echo ========================================
echo   Fix GitHub Remote URL
echo ========================================
echo.
echo Current remote URL:
git remote -v
echo.
echo.
set /p GITHUB_USER="Enter your GitHub username: "

if "%GITHUB_USER%"=="" (
    echo Error: Username is required
    pause
    exit /b 1
)

echo.
echo Removing old remote...
git remote remove origin

echo.
echo Adding new remote: https://github.com/%GITHUB_USER%/rundlekiosk.git
git remote add origin https://github.com/%GITHUB_USER%/rundlekiosk.git

echo.
echo Verifying remote...
git remote -v

echo.
echo ========================================
echo   Remote updated successfully!
echo ========================================
echo.
echo Now you can push with:
echo   git push -u origin main
echo.
echo Or run: push-to-github.bat
echo.
pause





