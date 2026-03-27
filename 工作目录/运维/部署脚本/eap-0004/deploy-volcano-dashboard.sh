#!/usr/bin/env bash
set -euo pipefail

PROFILE_NAME="${PROFILE_NAME:-eap-0001}"
VOLCANO_NS="volcano-system"
DASHBOARD_REF="${DASHBOARD_REF:-main}"
MANIFEST_API_URL="https://api.github.com/repos/volcano-sh/dashboard/contents/deployment/volcano-dashboard.yaml?ref=${DASHBOARD_REF}"
TMP_MANIFEST="$(mktemp -t volcano-dashboard.XXXXXX.yaml)"
trap 'rm -f "${TMP_MANIFEST}"' EXIT

echo "[INFO] Ensuring minikube profile '${PROFILE_NAME}' is running"
minikube status -p "${PROFILE_NAME}" >/dev/null
kubectl config use-context "${PROFILE_NAME}" >/dev/null

echo "[INFO] Fetching Volcano Dashboard manifest from ${MANIFEST_API_URL}"
curl -sS --max-time 30 "${MANIFEST_API_URL}" \
  | jq -er '.content // error("unable to fetch manifest content")' \
  | tr -d '\n' \
  | base64 --decode > "${TMP_MANIFEST}"

echo "[INFO] Applying Volcano Dashboard manifest"
kubectl apply -f "${TMP_MANIFEST}"

echo "[INFO] Waiting for Volcano Dashboard deployment"
kubectl wait --for=condition=Available deployment/volcano-dashboard -n "${VOLCANO_NS}" --timeout=300s

echo "[INFO] Volcano Dashboard pods"
kubectl get pods -n "${VOLCANO_NS}" -l app=volcano-dashboard -o wide

echo "[INFO] Volcano Dashboard service"
kubectl get svc volcano-dashboard -n "${VOLCANO_NS}" -o wide

echo
echo "[SUCCESS] Volcano Dashboard is ready"
echo "[INFO] To open UI, run in another terminal:"
echo "  minikube -p ${PROFILE_NAME} service -n ${VOLCANO_NS} volcano-dashboard --url"
