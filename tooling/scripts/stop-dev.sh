#!/bin/bash
# Stop the Graphone Linux dev app previously started by start-dev-and-wait.sh.

set -euo pipefail

TMP_DIR="${TMPDIR:-/tmp}"
LOG_FILE="${TMP_DIR}/graphone-dev.log"
PGID_FILE="${TMP_DIR}/graphone-dev.pgid"
APP_PID_FILE="${TMP_DIR}/graphone-dev.app.pid"

if [ ! -f "$PGID_FILE" ]; then
  echo "No Graphone dev process group file found at ${PGID_FILE}"
  rm -f "$APP_PID_FILE"
  exit 0
fi

PGID="$(cat "$PGID_FILE" 2>/dev/null || true)"
if [ -z "$PGID" ]; then
  echo "Graphone dev process group file is empty"
  rm -f "$PGID_FILE" "$APP_PID_FILE"
  exit 0
fi

kill -- "-${PGID}" 2>/dev/null || true

for _ in $(seq 1 10); do
  if ! kill -0 -- "-${PGID}" 2>/dev/null; then
    rm -f "$PGID_FILE" "$APP_PID_FILE"
    echo "Stopped Graphone dev process group ${PGID}"
    echo "log=${LOG_FILE}"
    exit 0
  fi
  sleep 1
done

kill -9 -- "-${PGID}" 2>/dev/null || true
sleep 1
rm -f "$PGID_FILE" "$APP_PID_FILE"
echo "Stopped Graphone dev process group ${PGID} (forced)"
echo "log=${LOG_FILE}"
