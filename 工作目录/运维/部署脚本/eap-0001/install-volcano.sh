#!/usr/bin/env bash
set -euo pipefail

VOLCANO_VERSION="${VOLCANO_VERSION:-v1.14.1}"
MANIFEST_URL="https://raw.githubusercontent.com/volcano-sh/volcano/${VOLCANO_VERSION}/installer/volcano-development.yaml"

echo "[INFO] Installing Volcano ${VOLCANO_VERSION}"
kubectl apply -f "${MANIFEST_URL}"

echo "[INFO] Waiting Volcano control plane components"
kubectl wait --for=condition=Available deployment/volcano-admission -n volcano-system --timeout=180s
kubectl wait --for=condition=Available deployment/volcano-controllers -n volcano-system --timeout=180s
kubectl wait --for=condition=Available deployment/volcano-scheduler -n volcano-system --timeout=180s

echo "[INFO] Volcano components status"
kubectl get pods -n volcano-system -o wide
