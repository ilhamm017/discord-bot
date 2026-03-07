#!/usr/bin/env bash
set -euo pipefail

CONFIG_WEB_HOST="${CONFIG_WEB_HOST:-0.0.0.0}"
CONFIG_WEB_PORT="${CONFIG_WEB_PORT:-3210}"

shutdown() {
  local exit_code="${1:-0}"

  if [[ -n "${BOT_PID:-}" ]] && kill -0 "${BOT_PID}" 2>/dev/null; then
    kill -TERM "${BOT_PID}" 2>/dev/null || true
  fi

  if [[ -n "${WEB_PID:-}" ]] && kill -0 "${WEB_PID}" 2>/dev/null; then
    kill -TERM "${WEB_PID}" 2>/dev/null || true
  fi

  wait "${BOT_PID:-}" 2>/dev/null || true
  wait "${WEB_PID:-}" 2>/dev/null || true
  exit "${exit_code}"
}

trap 'shutdown 0' SIGINT SIGTERM

CONFIG_WEB_HOST="${CONFIG_WEB_HOST}" CONFIG_WEB_PORT="${CONFIG_WEB_PORT}" node config/web/server.js &
WEB_PID=$!

node index.js &
BOT_PID=$!

set +e
wait -n "${WEB_PID}" "${BOT_PID}"
EXIT_CODE=$?
set -e

shutdown "${EXIT_CODE}"
