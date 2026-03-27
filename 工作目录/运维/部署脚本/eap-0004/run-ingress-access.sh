#!/usr/bin/env bash
set -euo pipefail

K8S_HOST="${K8S_HOST:-k8s-dashboard.localhost}"
VOLCANO_HOST="${VOLCANO_HOST:-volcano-dashboard.localhost}"
NAMESPACE="${NAMESPACE:-ingress-nginx}"
SERVICE_NAME="${SERVICE_NAME:-ingress-nginx-controller}"
LOCAL_PORT="${LOCAL_PORT:-18080}"

echo "[INFO] Using stable local port ${LOCAL_PORT} for ingress access"
echo "[INFO] Open URLs:"
echo "  http://${K8S_HOST}:${LOCAL_PORT}/"
echo "  http://${VOLCANO_HOST}:${LOCAL_PORT}/"
echo "[INFO] Quick checks:"
echo "  curl -H 'Host: ${K8S_HOST}' http://127.0.0.1:${LOCAL_PORT}/"
echo "  curl -H 'Host: ${VOLCANO_HOST}' http://127.0.0.1:${LOCAL_PORT}/"
echo

echo "[INFO] Starting port-forward now; keep this terminal open."
echo "[INFO] Press Ctrl+C to stop."
exec kubectl -n "${NAMESPACE}" port-forward "service/${SERVICE_NAME}" "${LOCAL_PORT}:80"
