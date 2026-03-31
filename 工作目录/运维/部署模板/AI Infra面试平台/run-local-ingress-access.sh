#!/usr/bin/env bash
set -euo pipefail

WEB_HOST="${WEB_HOST:-interview.localhost}"
API_HOST="${API_HOST:-api.interview.localhost}"
AUTH_HOST="${AUTH_HOST:-auth.interview.localhost}"
NAMESPACE="${NAMESPACE:-ingress-nginx}"
SERVICE_NAME="${SERVICE_NAME:-ingress-nginx-controller}"
LOCAL_PORT="${LOCAL_PORT:-18080}"

echo "[INFO] Using stable local port ${LOCAL_PORT} for ingress access"
echo "[INFO] Open URLs:"
echo "  http://${WEB_HOST}:${LOCAL_PORT}/"
echo "  http://${API_HOST}:${LOCAL_PORT}/"
echo "  http://${AUTH_HOST}:${LOCAL_PORT}/"
echo "[INFO] Quick checks:"
echo "  curl -H 'Host: ${WEB_HOST}' http://127.0.0.1:${LOCAL_PORT}/"
echo "  curl -H 'Host: ${API_HOST}' http://127.0.0.1:${LOCAL_PORT}/"
echo "  curl -H 'Host: ${AUTH_HOST}' http://127.0.0.1:${LOCAL_PORT}/realms/master"
echo

echo "[INFO] Starting port-forward now; keep this terminal open."
echo "[INFO] Press Ctrl+C to stop."
exec kubectl -n "${NAMESPACE}" port-forward "service/${SERVICE_NAME}" "${LOCAL_PORT}:80"
