#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# 拾光 · 摄影画廊 — 一键部署脚本 (Linux)
# 适用: Ubuntu 20.04+ / Debian 11+ / CentOS 8+ 等
# 用法: bash deploy.sh [--with-systemd]
# ─────────────────────────────────────────────────────────
set -e

APP_NAME="photo-gallery"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$APP_DIR/.venv"
PYTHON_MIN="3.10"
HOST="0.0.0.0"
PORT="8000"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ─── 1. 检测 Python ─────────────────────────────────────
find_python() {
    for cmd in python3 python; do
        if command -v "$cmd" &>/dev/null; then
            local ver
            ver=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
            local major minor
            major=$(echo "$ver" | cut -d. -f1)
            minor=$(echo "$ver" | cut -d. -f2)
            if [ "$major" -ge 3 ] && [ "$minor" -ge 10 ]; then
                echo "$cmd"
                return 0
            fi
        fi
    done
    return 1
}

info "检测 Python 环境..."
PYTHON_CMD=$(find_python) || error "未找到 Python >= $PYTHON_MIN，请先安装: sudo apt install python3 python3-venv python3-pip"
PYTHON_VER=$($PYTHON_CMD -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')")
info "使用 Python $PYTHON_VER ($PYTHON_CMD)"

# ─── 2. 创建虚拟环境 ────────────────────────────────────
if [ -d "$VENV_DIR" ]; then
    info "虚拟环境已存在，跳过创建"
else
    info "创建虚拟环境 → $VENV_DIR"
    $PYTHON_CMD -m venv "$VENV_DIR"
fi

# 激活
source "$VENV_DIR/bin/activate"

# ─── 3. 安装依赖 ────────────────────────────────────────
info "安装 Python 依赖..."
pip install --upgrade pip -q
pip install -r "$APP_DIR/requirements.txt" -q
info "依赖安装完成"

# ─── 4. 创建数据目录 ────────────────────────────────────
mkdir -p "$APP_DIR/assets/thumbs" "$APP_DIR/data"
info "数据目录就绪 (assets/, data/)"

# 初始化空数据文件（如不存在）
[ -f "$APP_DIR/data/photos.json" ] || echo "[]" > "$APP_DIR/data/photos.json"
[ -f "$APP_DIR/data/series.json" ] || echo "[]" > "$APP_DIR/data/series.json"

# ─── 5. 可选: 注册 systemd 服务 ─────────────────────────
if [ "$1" = "--with-systemd" ]; then
    SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
    info "注册 systemd 服务 → $SERVICE_FILE"

    sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Photo Gallery - FastAPI
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$APP_DIR
ExecStart=$VENV_DIR/bin/uvicorn main:app --host $HOST --port $PORT
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable "$APP_NAME"
    sudo systemctl restart "$APP_NAME"
    info "服务已启动并设为开机自启: systemctl status $APP_NAME"
else
    info "提示: 使用 --with-systemd 参数可注册为系统服务（开机自启）"
fi

# ─── 6. 完成 ────────────────────────────────────────────
echo ""
info "═══════════════════════════════════════════════"
info " 部署完成！"
info "═══════════════════════════════════════════════"
echo ""
info "手动启动:"
echo "  cd $APP_DIR"
echo "  source .venv/bin/activate"
echo "  uvicorn main:app --host $HOST --port $PORT"
echo ""
info "访问地址: http://<服务器IP>:$PORT"
info "管理后台: http://<服务器IP>:$PORT/admin"
echo ""
