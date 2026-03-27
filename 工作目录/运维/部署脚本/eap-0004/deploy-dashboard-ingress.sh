#!/usr/bin/env bash
set -euo pipefail

PROFILE_NAME="${PROFILE_NAME:-eap-0001}"
MANIFEST_PATH="${MANIFEST_PATH:-$(dirname "$0")/manifests/dashboard-ingress.yaml}"

K8S_HOST="${K8S_HOST:-k8s-dashboard.localhost}"
VOLCANO_HOST="${VOLCANO_HOST:-volcano-dashboard.localhost}"

echo "[INFO] Ensuring minikube profile '${PROFILE_NAME}' is running"
minikube status -p "${PROFILE_NAME}" >/dev/null
kubectl config use-context "${PROFILE_NAME}" >/dev/null

echo "[INFO] Enabling minikube ingress addon"
minikube -p "${PROFILE_NAME}" addons enable ingress >/dev/null

echo "[INFO] Ensuring IngressClass 'nginx' exists"
cat <<'YAML' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: nginx
spec:
  controller: k8s.io/ingress-nginx
YAML

echo "[INFO] Applying compatibility RBAC patch for ingress leader election"
cat <<'YAML' | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ingress-nginx
  namespace: ingress-nginx
rules:
- apiGroups: [""]
  resources: ["namespaces"]
  verbs: ["get"]
- apiGroups: [""]
  resources: ["configmaps", "pods", "secrets", "endpoints"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["services"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["extensions", "networking.k8s.io"]
  resources: ["ingresses"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["extensions", "networking.k8s.io"]
  resources: ["ingresses/status"]
  verbs: ["update"]
- apiGroups: ["networking.k8s.io"]
  resources: ["ingressclasses"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resourceNames: ["ingress-controller-leader", "ingress-controller-leader-nginx"]
  resources: ["configmaps"]
  verbs: ["get", "update"]
- apiGroups: [""]
  resources: ["configmaps"]
  verbs: ["create"]
- apiGroups: [""]
  resources: ["events"]
  verbs: ["create", "patch"]
YAML

echo "[INFO] Waiting for ingress-nginx controller"
kubectl wait --for=condition=Available deployment/ingress-nginx-controller -n ingress-nginx --timeout=300s

echo "[INFO] Applying ingress manifests: ${MANIFEST_PATH}"
kubectl apply -f "${MANIFEST_PATH}"

echo "[INFO] Current ingress objects"
kubectl get ingress -A -o wide

echo
echo "[SUCCESS] Ingress exposure completed"
echo "[INFO] Start access helper in another terminal:"
echo "  bash $(dirname "$0")/run-ingress-access.sh"
echo "[INFO] Helper exposes stable URLs on local port 18080:"
echo "  http://${K8S_HOST}:18080/"
echo "  http://${VOLCANO_HOST}:18080/"
echo "[INFO] No /etc/hosts edits are required."
