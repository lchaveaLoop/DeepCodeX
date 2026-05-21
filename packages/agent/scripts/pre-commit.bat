@echo off
REM FAgent pre-commit hook - Windows batch script

echo Running pre-commit checks...

cd /d "%~dp0\.."

REM 运行 ESLint
echo Running ESLint...
call npx eslint src/
if errorlevel 1 (
    echo ESLint check failed!
    exit /b 1
)

REM 运行 Prettier 检查
echo Running Prettier...
call npx prettier --check src/
if errorlevel 1 (
    echo Prettier check failed!
    exit /b 1
)

echo Pre-commit checks passed!
exit /b 0