@echo off
chcp 65001 >nul 2>&1
REM ─────────────────────────────────────────────────────────
REM 拾光 · 摄影画廊 — 一键部署脚本 (Windows)
REM 用法: 双击运行，或在终端执行 deploy.bat
REM ─────────────────────────────────────────────────────────
setlocal enabledelayedexpansion

set "APP_DIR=%~dp0"
set "VENV_DIR=%APP_DIR%.venv"
set "HOST=127.0.0.1"
set "PORT=8000"

echo [INFO] 拾光 · 摄影画廊 部署脚本
echo.

REM ─── 1. 检测 Python ─────────────────────────────────────
echo [INFO] 检测 Python 环境...
set "PYTHON_CMD="

where python >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set "PY_VER=%%v"
    set "PYTHON_CMD=python"
    goto :python_found
)

where python3 >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=2 delims= " %%v in ('python3 --version 2^>^&1') do set "PY_VER=%%v"
    set "PYTHON_CMD=python3"
    goto :python_found
)

where py >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=2 delims= " %%v in ('py --version 2^>^&1') do set "PY_VER=%%v"
    set "PYTHON_CMD=py"
    goto :python_found
)

echo [ERROR] 未找到 Python，请先安装 Python 3.10+:
echo         https://www.python.org/downloads/
echo         安装时勾选 "Add Python to PATH"
pause
exit /b 1

:python_found
echo [INFO] 找到 Python !PY_VER! (!PYTHON_CMD!)

REM 检查版本 >= 3.10
for /f "tokens=1,2 delims=." %%a in ("!PY_VER!") do (
    set "PY_MAJOR=%%a"
    set "PY_MINOR=%%b"
)
if !PY_MAJOR! LSS 3 (
    echo [ERROR] 需要 Python 3.10+，当前为 !PY_VER!
    pause
    exit /b 1
)
if !PY_MINOR! LSS 10 (
    echo [ERROR] 需要 Python 3.10+，当前为 !PY_VER!
    pause
    exit /b 1
)

REM ─── 2. 创建虚拟环境 ────────────────────────────────────
if exist "%VENV_DIR%\Scripts\python.exe" (
    echo [INFO] 虚拟环境已存在，跳过创建
) else (
    echo [INFO] 创建虚拟环境...
    !PYTHON_CMD! -m venv "%VENV_DIR%"
    if !errorlevel! neq 0 (
        echo [ERROR] 创建虚拟环境失败
        pause
        exit /b 1
    )
)

REM ─── 3. 安装依赖 ────────────────────────────────────────
echo [INFO] 安装 Python 依赖...
"%VENV_DIR%\Scripts\python.exe" -m pip install --upgrade pip -q
"%VENV_DIR%\Scripts\python.exe" -m pip install -r "%APP_DIR%requirements.txt" -q
if !errorlevel! neq 0 (
    echo [ERROR] 依赖安装失败，请检查网络连接
    pause
    exit /b 1
)
echo [INFO] 依赖安装完成

REM ─── 4. 创建数据目录 ────────────────────────────────────
if not exist "%APP_DIR%assets\thumbs" mkdir "%APP_DIR%assets\thumbs"
if not exist "%APP_DIR%data" mkdir "%APP_DIR%data"

REM 初始化空数据文件
if not exist "%APP_DIR%data\photos.json" echo [] > "%APP_DIR%data\photos.json"
if not exist "%APP_DIR%data\series.json" echo [] > "%APP_DIR%data\series.json"
echo [INFO] 数据目录就绪

REM ─── 5. 完成 ────────────────────────────────────────────
echo.
echo ═══════════════════════════════════════════════
echo  部署完成！
echo ═══════════════════════════════════════════════
echo.
echo  启动服务:
echo    "%VENV_DIR%\Scripts\python.exe" -m uvicorn main:app --host %HOST% --port %PORT%
echo.
echo  访问地址: http://%HOST%:%PORT%
echo  管理后台: http://%HOST%:%PORT%/admin
echo.

REM ─── 6. 询问是否立即启动 ────────────────────────────────
set /p "START_NOW=是否立即启动服务? (Y/n): "
if /i "!START_NOW!"=="n" goto :end
if /i "!START_NOW!"=="N" goto :end

echo [INFO] 启动服务中... (Ctrl+C 停止)
cd /d "%APP_DIR%"
"%VENV_DIR%\Scripts\python.exe" -m uvicorn main:app --host %HOST% --port %PORT%

:end
endlocal
