#!/usr/bin/env bash
set -euo pipefail

PROFILE_NAME="${PROFILE_NAME:-eap-0001}"
DRIVER="${DRIVER:-docker}"
K8S_VERSION="${K8S_VERSION:-v1.22.1}"
CPUS="${CPUS:-4}"
MEMORY="${MEMORY:-8192}"

echo "[INFO] Creating minikube profile: ${PROFILE_NAME}"
minikube start \
  -p "${PROFILE_NAME}" \
  --driver="${DRIVER}" \
  --kubernetes-version="${K8S_VERSION}" \
  --cpus="${CPUS}" \
  --memory="${MEMORY}"

echo "[INFO] Switching kubectl context to ${PROFILE_NAME}"
kubectl config use-context "${PROFILE_NAME}"

echo "[INFO] Cluster is ready"
kubectl get nodes -o wide
