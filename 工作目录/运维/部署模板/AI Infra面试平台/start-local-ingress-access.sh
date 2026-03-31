#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="${SCRIPT_DIR}/.runtime"
PID_FILE="${RUNTIME_DIR}/ingress-port-forward.pid"
LOG_FILE="${RUNTIME_DIR}/ingress-port-forward.log"

WEB_HOST="${WEB_HOST:-interview.localhost}"
API_HOST="${API_HOST:-api.interview.localhost}"
AUTH_HOST="${AUTH_HOST:-auth.interview.localhost}"
NAMESPACE="${NAMESPACE:-ingress-nginx}"
SERVICE_NAME="${SERVICE_NAME:-ingress-nginx-controller}"
LOCAL_PORT="${LOCAL_PORT:-18080}"

mkdir -p "${RUNTIME_DIR}"

is_running() {
  if [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}")"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      return 0
    fi
  fi
  local existing_pid
  existing_pid="$(lsof -t -iTCP:${LOCAL_PORT} -sTCP:LISTEN 2>/dev/null | head -n1 || true)"
  if [[ -n "${existing_pid}" ]]; then
    echo "${existing_pid}" > "${PID_FILE}"
    return 0
  fi
  return 1
}

if is_running; then
  echo "[INFO] Port-forward already running (pid $(cat "${PID_FILE}"))."
else
  echo "[INFO] Starting background port-forward on localhost:${LOCAL_PORT}"
  nohup kubectl -n "${NAMESPACE}" port-forward "service/${SERVICE_NAME}" "${LOCAL_PORT}:80" >"${LOG_FILE}" 2>&1 &
  echo $! > "${PID_FILE}"
fi

for url in \
  "http://${WEB_HOST}:${LOCAL_PORT}/" \
  "http://${API_HOST}:${LOCAL_PORT}/" \
  "http://${AUTH_HOST}:${LOCAL_PORT}/realms/master"
do
  reachable=0
  for _ in {1..30}; do
    if curl -sS -o /dev/null --max-time 2 "${url}"; then
      reachable=1
      break
    fi
    sleep 1
  done
  if [[ "${reachable}" -ne 1 ]]; then
    echo "[ERROR] URL not reachable yet: ${url}"
    if [[ -f "${LOG_FILE}" ]]; then
      sed -n '1,120p' "${LOG_FILE}"
    fi
    exit 1
  fi
done

echo "[SUCCESS] Browser URLs are reachable"
echo "http://${WEB_HOST}:${LOCAL_PORT}/"
echo "http://${API_HOST}:${LOCAL_PORT}/"
echo "http://${AUTH_HOST}:${LOCAL_PORT}/"
