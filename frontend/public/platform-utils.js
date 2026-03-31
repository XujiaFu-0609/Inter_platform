export const RUN_STATUS_VALUES = ["pending", "running", "succeeded", "failed", "cancelling", "cancelled"];
export const SLA_TIER_VALUES = ["gold", "silver", "bronze"];
export const ENGINE_TYPE_VALUES = ["spark", "flink"];
export const ALERT_SEVERITY_VALUES = ["p0", "p1", "p2", "p3"];
export const ALERT_STATUS_VALUES = ["open", "acked", "resolved"];

function normalizeEnum(value, allowedValues) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  return allowedValues.includes(normalized) ? normalized : "";
}

function normalizePositiveInt(value, fallbackValue) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallbackValue;
  }
  return parsed;
}

export function normalizeRunsQuery(raw = {}) {
  return {
    engineType: normalizeEnum(raw.engineType, ENGINE_TYPE_VALUES),
    runStatus: normalizeEnum(raw.runStatus, RUN_STATUS_VALUES),
    slaTier: normalizeEnum(raw.slaTier, SLA_TIER_VALUES),
    queueName: typeof raw.queueName === "string" ? raw.queueName.trim() : "",
    page: normalizePositiveInt(raw.page, 1),
    pageSize: Math.min(200, normalizePositiveInt(raw.pageSize, 20)),
  };
}

export function normalizeAlertsQuery(raw = {}) {
  return {
    alertSeverity: normalizeEnum(raw.alertSeverity, ALERT_SEVERITY_VALUES),
    runStatus: normalizeEnum(raw.runStatus, RUN_STATUS_VALUES),
    page: normalizePositiveInt(raw.page, 1),
    pageSize: Math.min(200, normalizePositiveInt(raw.pageSize, 20)),
  };
}

export function buildQueryString(query = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      return;
    }
    searchParams.set(key, String(value));
  });
  return searchParams.toString();
}

function safeGrafanaBase(baseUrl) {
  if (typeof baseUrl !== "string") {
    return "";
  }
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/\/+$/, "");
}

export function buildGrafanaHref(baseUrl, grafana) {
  if (!grafana || typeof grafana !== "object") {
    return null;
  }

  const safeBase = safeGrafanaBase(baseUrl);
  if (!safeBase || !grafana.grafanaDashboardUid) {
    return null;
  }

  let url;
  try {
    url = new URL(`${safeBase}/d/${grafana.grafanaDashboardUid}`);
  } catch {
    return null;
  }
  if (grafana.grafanaPanelId !== null && grafana.grafanaPanelId !== undefined) {
    url.searchParams.set("viewPanel", String(grafana.grafanaPanelId));
  }
  if (grafana.grafanaFrom) {
    url.searchParams.set("from", String(grafana.grafanaFrom));
  }
  if (grafana.grafanaTo) {
    url.searchParams.set("to", String(grafana.grafanaTo));
  }
  if (grafana.grafanaVars && typeof grafana.grafanaVars === "object") {
    Object.entries(grafana.grafanaVars).forEach(([key, value]) => {
      if (value === null || value === undefined || value === "") {
        return;
      }
      url.searchParams.set(`var-${key}`, String(value));
    });
  }

  return url.toString();
}

export function applyRunsFilter(items, rawQuery = {}) {
  const query = normalizeRunsQuery(rawQuery);
  const filtered = items.filter((item) => {
    if (query.engineType && item.engineType !== query.engineType) {
      return false;
    }
    if (query.runStatus && item.runStatus !== query.runStatus) {
      return false;
    }
    if (query.slaTier && item.slaTier !== query.slaTier) {
      return false;
    }
    if (query.queueName && !String(item.queueName ?? "").toLowerCase().includes(query.queueName.toLowerCase())) {
      return false;
    }
    return true;
  });

  const start = (query.page - 1) * query.pageSize;
  return {
    items: filtered.slice(start, start + query.pageSize),
    total: filtered.length,
  };
}

export function applyAlertsFilter(items, rawQuery = {}) {
  const query = normalizeAlertsQuery(rawQuery);
  const filtered = items.filter((item) => {
    if (query.alertSeverity && item.alertSeverity !== query.alertSeverity) {
      return false;
    }
    if (query.runStatus && item.relatedRunStatus !== query.runStatus) {
      return false;
    }
    return true;
  });

  const start = (query.page - 1) * query.pageSize;
  return {
    items: filtered.slice(start, start + query.pageSize),
    total: filtered.length,
  };
}
