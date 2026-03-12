#!/bin/bash
# Start Graphone's Linux dev app in the background and block until it is ready.
# Intended workflow:
#   1. bash tooling/scripts/start-dev-and-wait.sh
#   2. take_screenshot
#   3. bash tooling/scripts/stop-dev.sh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

TMP_DIR="${TMPDIR:-/tmp}"
LOG_FILE="${TMP_DIR}/graphone-dev.log"
PGID_FILE="${TMP_DIR}/graphone-dev.pgid"
APP_PID_FILE="${TMP_DIR}/graphone-dev.app.pid"
TIMEOUT_SECONDS="${GRAPHONE_DEV_TIMEOUT_SECONDS:-240}"
POLL_INTERVAL_SECONDS="${GRAPHONE_DEV_POLL_INTERVAL_SECONDS:-1}"
APP_PROCESS_PATTERN="${REPO_ROOT}/src-tauri/target/debug/graphone"

cleanup_stale_state() {
  rm -f "$APP_PID_FILE"

  if [ ! -f "$PGID_FILE" ]; then
    return
  fi

  local existing_pgid
  existing_pgid="$(cat "$PGID_FILE" 2>/dev/null || true)"
  if [ -z "$existing_pgid" ]; then
    rm -f "$PGID_FILE"
    return
  fi

  if kill -0 -- "-${existing_pgid}" 2>/dev/null; then
    echo "Another Graphone dev session appears to still be running (pgid=${existing_pgid})."
    echo "Run: bash tooling/scripts/stop-dev.sh"
    exit 1
  fi

  rm -f "$PGID_FILE"
}

cleanup_on_timeout() {
  if [ -f "$PGID_FILE" ]; then
    local pgid
    pgid="$(cat "$PGID_FILE" 2>/dev/null || true)"
    if [ -n "$pgid" ]; then
      kill -- "-${pgid}" 2>/dev/null || true
      sleep 1
      kill -9 -- "-${pgid}" 2>/dev/null || true
    fi
  fi

  rm -f "$PGID_FILE" "$APP_PID_FILE"
}

cleanup_stale_state
rm -f "$LOG_FILE"

printf -v START_CMD 'cd %q && npm run dev:linux' "$REPO_ROOT"
setsid bash -lc "$START_CMD" >"$LOG_FILE" 2>&1 &
PGID="$!"
echo "$PGID" > "$PGID_FILE"

ready=0
for ((i = 0; i < TIMEOUT_SECONDS; i += POLL_INTERVAL_SECONDS)); do
  vite_ready=0
  tauri_started=0
  app_running=0

  if [ -f "$LOG_FILE" ]; then
    grep -Eq 'VITE[[:space:]].*ready|Local:[[:space:]]+http://localhost:1420/' "$LOG_FILE" && vite_ready=1 || true
    grep -Eq 'Running `target/debug/graphone`|Starting graphone' "$LOG_FILE" && tauri_started=1 || true
  fi

  app_pid="$(pgrep -f "$APP_PROCESS_PATTERN" | head -n 1 || true)"
  if [ -n "$app_pid" ]; then
    app_running=1
    echo "$app_pid" > "$APP_PID_FILE"
  fi

  if [ "$vite_ready" = "1" ] && [ "$tauri_started" = "1" ] && [ "$app_running" = "1" ]; then
    ready=1
    break
  fi

  sleep "$POLL_INTERVAL_SECONDS"
done

if [ "$ready" != "1" ]; then
  echo "Timed out waiting for Graphone dev readiness"
  echo "log=${LOG_FILE}"
  tail -n 200 "$LOG_FILE" 2>/dev/null || true
  cleanup_on_timeout
  exit 1
fi

echo "READY"
echo "log=${LOG_FILE}"
echo "pgid=${PGID}"
if [ -f "$APP_PID_FILE" ]; then
  echo "app_pid=$(cat "$APP_PID_FILE")"
fi
