{{- define "ai-interview.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ai-interview.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s" (include "ai-interview.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "ai-interview.labels" -}}
app.kubernetes.io/name: {{ include "ai-interview.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "ai-interview.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ai-interview.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "ai-interview.storageClassName" -}}
{{- if .Values.global.storageClass -}}
storageClassName: {{ .Values.global.storageClass | quote }}
{{- end -}}
{{- end -}}

{{- define "ai-interview.externalScheme" -}}
{{- ternary "https" "http" .Values.ingress.tls.enabled -}}
{{- end -}}
