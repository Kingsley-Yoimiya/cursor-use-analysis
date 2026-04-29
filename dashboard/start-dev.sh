#!/usr/bin/env bash
# 在 dashboard 目录下启动 server 与 web，日志写入带时间戳的子目录。
set -euo pipefail

DASHBOARD="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DASHBOARD/.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
LOGDIR="$DASHBOARD/logs/run-$TS"
mkdir -p "$LOGDIR"

{
  echo "仓库根目录: $REPO_ROOT"
  echo "dashboard: $DASHBOARD"
  echo "会话开始: $(date -Iseconds)"
} | tee "$LOGDIR/meta.log"

T_SERVER=$(date +%s%3N 2>/dev/null || date +%s)
(
  cd "$DASHBOARD/server"
  echo "[$(date -Iseconds)] 启动 Node server (PORT=${PORT:-3001})…"
  node index.js
) >>"$LOGDIR/server.log" 2>&1 &
echo $! >"$LOGDIR/server.pid"

sleep 1

T_WEB=$(date +%s%3N 2>/dev/null || date +%s)
(
  cd "$DASHBOARD/web"
  echo "[$(date -Iseconds)] 启动 Vite…"
  npm run dev -- --host 127.0.0.1 --port 5173
) >>"$LOGDIR/web.log" 2>&1 &
echo $! >"$LOGDIR/web.pid"

{
  echo "日志目录: $LOGDIR"
  echo "server PID: $(cat "$LOGDIR/server.pid")"
  echo "web PID: $(cat "$LOGDIR/web.pid")"
  echo "查看日志: tail -f \"$LOGDIR/server.log\" \"$LOGDIR/web.log\""
} | tee -a "$LOGDIR/meta.log"
