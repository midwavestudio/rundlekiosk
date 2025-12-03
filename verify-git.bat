@echo off
echo Checking Git repository status...
echo.

if exist .git (
    echo [OK] .git directory exists
) else (
    echo [ERROR] .git directory not found
    exit /b 1
)

echo.
echo Git status:
git status --short
echo.

echo Git branch:
git branch
echo.

echo Latest commit:
git log --oneline -1
echo.

echo [SUCCESS] Git repository is properly initialized!
pause






