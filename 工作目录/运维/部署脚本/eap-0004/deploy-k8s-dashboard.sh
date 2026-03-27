#!/usr/bin/env bash
set -euo pipefail

PROFILE_NAME="${PROFILE_NAME:-eap-0001}"
DASHBOARD_NS="kubernetes-dashboard"
DASHBOARD_SA="admin-user"
DASHBOARD_CRB="kubernetes-dashboard-admin-user"
TOKEN_DURATION="${TOKEN_DURATION:-24h}"

echo "[INFO] Ensuring minikube profile '${PROFILE_NAME}' is running"
minikube status -p "${PROFILE_NAME}" >/dev/null

kubectl config use-context "${PROFILE_NAME}" >/dev/null

echo "[INFO] Enabling metrics-server addon"
minikube addons enable metrics-server -p "${PROFILE_NAME}" >/dev/null

echo "[INFO] Enabling dashboard addon"
minikube addons enable dashboard -p "${PROFILE_NAME}" >/dev/null

echo "[INFO] Waiting for dashboard deployment"
kubectl wait --for=condition=Available deployment/kubernetes-dashboard -n "${DASHBOARD_NS}" --timeout=300s

echo "[INFO] Waiting for metrics-server deployment"
kubectl wait --for=condition=Available deployment/metrics-server -n kube-system --timeout=300s

echo "[INFO] Creating dashboard admin ServiceAccount and ClusterRoleBinding"
cat <<YAML | kubectl apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${DASHBOARD_SA}
  namespace: ${DASHBOARD_NS}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ${DASHBOARD_CRB}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
- kind: ServiceAccount
  name: ${DASHBOARD_SA}
  namespace: ${DASHBOARD_NS}
YAML

echo "[INFO] Generating login token for ${DASHBOARD_NS}/${DASHBOARD_SA}"
if TOKEN="$(kubectl -n "${DASHBOARD_NS}" create token "${DASHBOARD_SA}" --duration="${TOKEN_DURATION}" 2>/dev/null)"; then
  :
else
  SECRET_NAME="${DASHBOARD_SA}-token"
  cat <<YAML | kubectl apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: ${SECRET_NAME}
  namespace: ${DASHBOARD_NS}
  annotations:
    kubernetes.io/service-account.name: ${DASHBOARD_SA}
type: kubernetes.io/service-account-token
YAML
  kubectl -n "${DASHBOARD_NS}" wait --for=jsonpath='{.data.token}' "secret/${SECRET_NAME}" --timeout=60s >/dev/null
  TOKEN="$(kubectl -n "${DASHBOARD_NS}" get secret "${SECRET_NAME}" -o jsonpath='{.data.token}' | base64 --decode)"
fi

echo
echo "[SUCCESS] Kubernetes Dashboard is ready"
echo "[INFO] Start access proxy in another terminal:"
echo "  kubectl proxy"
echo "[INFO] Then open:"
echo "  http://localhost:8001/api/v1/namespaces/${DASHBOARD_NS}/services/https:kubernetes-dashboard:/proxy/"
echo "[INFO] Login token (${TOKEN_DURATION}):"
echo "${TOKEN}"
