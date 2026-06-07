#!/bin/zsh

set -e

cd "$(dirname "$0")"

if [[ ! -x ".tools/cloudflared" ]]; then
  echo "缺少 .tools/cloudflared，请先安装隧道工具。"
  exit 1
fi

cleanup() {
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

node server.mjs &
SERVER_PID=$!

sleep 1
.tools/cloudflared tunnel --url http://127.0.0.1:4173 --no-autoupdate
