#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="${SCRIPT_DIR}/.runtime"
PID_FILE="${RUNTIME_DIR}/ingress-port-forward.pid"
LOCAL_PORT="${LOCAL_PORT:-18080}"

stopped=0
if [[ -f "${PID_FILE}" ]]; then
  pid="$(cat "${PID_FILE}")"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
    kill "${pid}" >/dev/null 2>&1 || true
    stopped=1
    echo "[INFO] Stopped pid ${pid} from pidfile."
  fi
  rm -f "${PID_FILE}"
fi

for pid in $(lsof -t -iTCP:${LOCAL_PORT} -sTCP:LISTEN 2>/dev/null || true); do
  kill "${pid}" >/dev/null 2>&1 || true
  stopped=1
  echo "[INFO] Stopped listener pid ${pid} on port ${LOCAL_PORT}."
done

if [[ "${stopped}" -eq 0 ]]; then
  echo "[INFO] No active ingress access process found."
fi
