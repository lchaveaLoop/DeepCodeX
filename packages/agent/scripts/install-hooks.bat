@echo off
REM 安装 FAgent Git Hooks (Windows)

REM 获取项目根目录
for %%i in ("%~dp0..") do set PROJECT_ROOT=%%~fi
set HOOKS_DIR=%PROJECT_ROOT%\.git\hooks

echo Installing FAgent Git hooks to %HOOKS_DIR%...

REM 检查是否在 git 仓库中
if not exist "%PROJECT_ROOT%\.git" (
    echo Error: Not a git repository. Please run this script from the project root.
    exit /b 1
)

REM 复制 pre-commit hook
copy "%PROJECT_ROOT%\packages\agent\scripts\pre-commit.bat" "%HOOKS_DIR%\pre-commit.bat"
if errorlevel 1 (
    echo Error: Failed to install hooks.
    exit /b 1
)

echo.
echo Hooks installed successfully!
echo Run 'git commit' to trigger pre-commit checks.
exit /b 0