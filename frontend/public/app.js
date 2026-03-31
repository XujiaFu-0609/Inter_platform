import {
  ALERT_SEVERITY_VALUES,
  ENGINE_TYPE_VALUES,
  RUN_STATUS_VALUES,
  SLA_TIER_VALUES,
  applyAlertsFilter,
  applyRunsFilter,
  buildGrafanaHref,
  buildQueryString,
  normalizeAlertsQuery,
  normalizeRunsQuery,
} from "./platform-utils.js";

const state = {
  session: null,
  questions: [],
  answers: {},
  currentQuestionId: null,
  lastRequestId: null,
  lastSaveMessage: "",
  resultSummary: null,
  apiBaseUrl: "",
  grafanaBaseUrl: "",
  platformMode: "api",
  permissions: {
    canAckAlert: true,
    canOpenGrafana: true,
  },
};

const CANONICAL_API_BASE_PATH = "/api/v1/interview-sessions";
const PLATFORM_API_BASE_PATH = "/api/v1/platform";
const API_BASE_URL_STORAGE_KEY = "cloud-native:api-base-url";
const PLATFORM_CACHE_TTL_MS = 15_000;
const cleanupTasks = [];
const appElement = document.querySelector("#app");
const platformResponseCache = new Map();

const RUN_STATUS_META = {
  pending: { label: "Pending", tone: "neutral" },
  running: { label: "Running", tone: "success" },
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelling: { label: "Cancelling", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const ALERT_STATUS_META = {
  open: { label: "Open", tone: "danger" },
  acked: { label: "Acked", tone: "warning" },
  resolved: { label: "Resolved", tone: "success" },
};

const HEALTH_STATUS_META = {
  healthy: { label: "Healthy", tone: "success" },
  degraded: { label: "Degraded", tone: "warning" },
  down: { label: "Down", tone: "danger" },
};

const ALERT_SEVERITY_META = {
  p0: { label: "P0", tone: "danger" },
  p1: { label: "P1", tone: "danger" },
  p2: { label: "P2", tone: "warning" },
  p3: { label: "P3", tone: "neutral" },
};

const platformMockStore = {
  overview: {
    controlPlaneHealth: "healthy",
    runtimeHealth: "degraded",
    alertHealth: "degraded",
    queueUtilization: [
      { queueName: "prod-realtime", pendingDepth: 18, runningCount: 42, utilizationRatio: 0.82, slaTier: "gold" },
      { queueName: "prod-batch", pendingDepth: 6, runningCount: 19, utilizationRatio: 0.56, slaTier: "silver" },
      { queueName: "staging-sandbox", pendingDepth: 1, runningCount: 4, utilizationRatio: 0.21, slaTier: "bronze" },
    ],
    slaBreachCount24h: 3,
    generatedAt: "2026-03-31T06:00:00.000Z",
  },
  runs: [
    {
      runId: "run_flk_prod_001",
      engineType: "flink",
      pipelineId: "pipe_realtime_reco",
      queueName: "prod-realtime",
      runStatus: "running",
      slaTier: "gold",
      owner: "streaming-team",
      retryCount: 0,
      checkpointLagMs: 2900,
      stageProgress: null,
      startTime: "2026-03-31T05:20:00.000Z",
      endTime: null,
      durationMs: null,
      grafana: {
        grafanaDashboardUid: "cn-runtime-overview",
        grafanaPanelId: 16,
        grafanaFrom: "now-1h",
        grafanaTo: "now",
        grafanaVars: { runId: "run_flk_prod_001", engineType: "flink" },
      },
    },
    {
      runId: "run_spk_batch_013",
      engineType: "spark",
      pipelineId: "pipe_nightly_feature",
      queueName: "prod-batch",
      runStatus: "failed",
      slaTier: "silver",
      owner: "feature-team",
      retryCount: 2,
      checkpointLagMs: null,
      stageProgress: 0.72,
      startTime: "2026-03-31T02:10:00.000Z",
      endTime: "2026-03-31T02:39:00.000Z",
      durationMs: 1_740_000,
      grafana: {
        grafanaDashboardUid: "cn-runtime-overview",
        grafanaPanelId: 22,
        grafanaFrom: "now-6h",
        grafanaTo: "now",
        grafanaVars: { runId: "run_spk_batch_013", engineType: "spark" },
      },
    },
    {
      runId: "run_spk_batch_014",
      engineType: "spark",
      pipelineId: "pipe_nightly_billing",
      queueName: "prod-batch",
      runStatus: "succeeded",
      slaTier: "silver",
      owner: "billing-team",
      retryCount: 1,
      checkpointLagMs: null,
      stageProgress: 1,
      startTime: "2026-03-31T00:40:00.000Z",
      endTime: "2026-03-31T01:19:00.000Z",
      durationMs: 2_340_000,
      grafana: {
        grafanaDashboardUid: "cn-runtime-overview",
        grafanaPanelId: 19,
        grafanaFrom: "now-8h",
        grafanaTo: "now",
        grafanaVars: { runId: "run_spk_batch_014", engineType: "spark" },
      },
    },
  ],
  runDetails: {},
  alerts: [
    {
      alertId: "alert_prod_1001",
      alertSeverity: "p1",
      alertStatus: "open",
      sourceType: "run",
      sourceId: "run_spk_batch_013",
      relatedRunId: "run_spk_batch_013",
      relatedRunStatus: "failed",
      summary: "Spark batch stage-3 OOM，连续重试后失败",
      labels: { queue: "prod-batch", owner: "feature-team" },
      triggeredAt: "2026-03-31T02:41:00.000Z",
      ackedAt: null,
      resolvedAt: null,
      grafana: {
        grafanaDashboardUid: "cn-alert-center",
        grafanaPanelId: 6,
        grafanaFrom: "now-6h",
        grafanaTo: "now",
        grafanaVars: { alertId: "alert_prod_1001", runId: "run_spk_batch_013" },
      },
    },
    {
      alertId: "alert_prod_1002",
      alertSeverity: "p2",
      alertStatus: "acked",
      sourceType: "operator",
      sourceId: "interviewplatform/default",
      relatedRunId: null,
      relatedRunStatus: "running",
      summary: "Operator reconcile latency 连续 5 分钟超阈值",
      labels: { component: "controller-runtime" },
      triggeredAt: "2026-03-31T04:12:00.000Z",
      ackedAt: "2026-03-31T04:19:00.000Z",
      resolvedAt: null,
      grafana: {
        grafanaDashboardUid: "cn-alert-center",
        grafanaPanelId: 11,
        grafanaFrom: "now-3h",
        grafanaTo: "now",
        grafanaVars: { alertId: "alert_prod_1002" },
      },
    },
    {
      alertId: "alert_prod_1003",
      alertSeverity: "p3",
      alertStatus: "resolved",
      sourceType: "infra",
      sourceId: "k8s/nodepool",
      relatedRunId: null,
      relatedRunStatus: "running",
      summary: "Node pool 短时 CPU 抖动已恢复",
      labels: { cluster: "prod-cn", region: "ap-east-1" },
      triggeredAt: "2026-03-30T23:01:00.000Z",
      ackedAt: "2026-03-30T23:07:00.000Z",
      resolvedAt: "2026-03-30T23:15:00.000Z",
      grafana: {
        grafanaDashboardUid: "cn-alert-center",
        grafanaPanelId: 4,
        grafanaFrom: "now-24h",
        grafanaTo: "now",
        grafanaVars: { alertId: "alert_prod_1003" },
      },
    },
  ],
};
platformMockStore.runs.forEach((run) => {
  platformMockStore.runDetails[run.runId] = {
    ...run,
    failureCode: run.runStatus === "failed" ? "SPARK_EXECUTOR_OOM" : null,
    failureReason: run.runStatus === "failed" ? "executor memory exceeded request/limit" : null,
    events: [
      {
        eventTime: run.startTime,
        eventType: "run_started",
        message: `${run.engineType.toUpperCase()} run started`,
      },
      {
        eventTime: run.runStatus === "failed" ? run.endTime : "2026-03-31T06:08:00.000Z",
        eventType: run.runStatus === "failed" ? "run_failed" : "checkpoint_updated",
        message: run.runStatus === "failed" ? "job failed after retries" : "checkpoint lag back to baseline",
      },
    ],
  };
});

function normalizeApiBaseUrl(rawValue) {
  if (typeof rawValue !== "string") {
    return "";
  }

  const trimmed = rawValue.trim();
  if (!trimmed || trimmed === "default" || trimmed === "same-origin") {
    return "";
  }

  return trimmed.replace(/\/+$/, "");
}

function readPersistedApiBaseUrl() {
  try {
    return normalizeApiBaseUrl(localStorage.getItem(API_BASE_URL_STORAGE_KEY) ?? "");
  } catch {
    return "";
  }
}

function persistApiBaseUrl(value) {
  try {
    if (!value) {
      localStorage.removeItem(API_BASE_URL_STORAGE_KEY);
      return;
    }

    localStorage.setItem(API_BASE_URL_STORAGE_KEY, value);
  } catch {}
}

function resolveApiBaseUrl() {
  const query = new URLSearchParams(window.location.search).get("apiBaseUrl");
  const runtime = normalizeApiBaseUrl(window.__CLOUD_NATIVE_CONFIG__?.apiBaseUrl ?? "");
  const persisted = readPersistedApiBaseUrl();
  const resolved = query !== null ? normalizeApiBaseUrl(query) : runtime || persisted;

  state.apiBaseUrl = resolved;
  persistApiBaseUrl(resolved);
}

function resolveGrafanaBaseUrl() {
  const query = new URLSearchParams(window.location.search).get("grafanaBaseUrl");
  const runtime = normalizeApiBaseUrl(window.__CLOUD_NATIVE_CONFIG__?.grafanaBaseUrl ?? "");
  const resolved = query !== null ? normalizeApiBaseUrl(query) : runtime;
  if (resolved.startsWith("/")) {
    state.grafanaBaseUrl = `${window.location.origin}${resolved}`;
    return;
  }
  state.grafanaBaseUrl = resolved;
}

function resolvePermissions() {
  const runtimePermissions = window.__CLOUD_NATIVE_CONFIG__?.permissions ?? {};
  state.permissions = {
    canAckAlert: runtimePermissions.canAckAlert !== false,
    canOpenGrafana: runtimePermissions.canOpenGrafana !== false,
  };
}

function formatApiBaseUrl() {
  return state.apiBaseUrl || window.location.origin;
}

function buildCanonicalApiUrl(pathname = "") {
  return `${state.apiBaseUrl}${CANONICAL_API_BASE_PATH}${pathname}`;
}

function buildPlatformApiUrl(pathname = "", query = null) {
  const queryString = query ? buildQueryString(query) : "";
  const suffix = queryString ? `?${queryString}` : "";
  return `${state.apiBaseUrl}${PLATFORM_API_BASE_PATH}${pathname}${suffix}`;
}

function getPlatformMockOverride() {
  const value = new URLSearchParams(window.location.search).get("platformMock");
  if (value === "1" || value === "on" || value === "true") {
    return true;
  }
  if (value === "0" || value === "off" || value === "false") {
    return false;
  }
  return null;
}

function shouldUsePlatformMockFallback(error) {
  const override = getPlatformMockOverride();
  if (override !== null) {
    return override;
  }
  return error?.status === 404 || error?.status === 501 || error?.status === 503;
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function clearPlatformCache() {
  platformResponseCache.clear();
}

async function withPlatformCache(cacheKey, loader) {
  if (!cacheKey) {
    return loader();
  }

  const cached = platformResponseCache.get(cacheKey);
  if (cached && cached.expireAt > Date.now()) {
    return cloneJsonValue(cached.value);
  }

  const value = await loader();
  platformResponseCache.set(cacheKey, {
    expireAt: Date.now() + PLATFORM_CACHE_TTL_MS,
    value: cloneJsonValue(value),
  });
  return value;
}

async function callPlatformApi({ pathname, query = null, method = "GET", body = null, headers = {}, cacheKey, mockResolver }) {
  if (getPlatformMockOverride() === true && typeof mockResolver === "function") {
    state.platformMode = "mock";
    return mockResolver();
  }

  return withPlatformCache(cacheKey, async () => {
    try {
      const response = await apiFetch(buildPlatformApiUrl(pathname, query), {
        method,
        body: body ? JSON.stringify(body) : null,
        headers,
      });
      state.platformMode = "api";
      return response;
    } catch (error) {
      if (typeof mockResolver === "function" && shouldUsePlatformMockFallback(error)) {
        state.platformMode = "mock";
        return mockResolver();
      }
      throw error;
    }
  });
}

const platformApi = {
  getOverview() {
    return callPlatformApi({
      pathname: "/overview",
      cacheKey: "overview",
      mockResolver() {
        return cloneJsonValue(platformMockStore.overview);
      },
    });
  },
  listRuns(rawQuery) {
    const query = normalizeRunsQuery(rawQuery);
    return callPlatformApi({
      pathname: "/runs",
      query,
      cacheKey: `runs:${buildQueryString(query)}`,
      mockResolver() {
        return applyRunsFilter(cloneJsonValue(platformMockStore.runs), query);
      },
    });
  },
  getRunDetail(runId) {
    return callPlatformApi({
      pathname: `/runs/${runId}`,
      cacheKey: `run:${runId}`,
      mockResolver() {
        const detail = platformMockStore.runDetails[runId];
        if (!detail) {
          const error = new Error("RUN_NOT_FOUND：运行实例不存在");
          error.status = 404;
          throw error;
        }
        return cloneJsonValue(detail);
      },
    });
  },
  listAlerts(rawQuery) {
    const query = normalizeAlertsQuery(rawQuery);
    return callPlatformApi({
      pathname: "/alerts",
      query,
      cacheKey: `alerts:${buildQueryString(query)}`,
      mockResolver() {
        return applyAlertsFilter(cloneJsonValue(platformMockStore.alerts), query);
      },
    });
  },
  async ackAlert(alertId) {
    const response = await callPlatformApi({
      pathname: `/alerts/${alertId}/ack`,
      method: "POST",
      headers: {
        "idempotency-key": `ack:${alertId}:${Date.now()}`,
      },
      cacheKey: null,
      mockResolver() {
        const index = platformMockStore.alerts.findIndex((item) => item.alertId === alertId);
        if (index === -1) {
          const error = new Error("ALERT_NOT_FOUND：告警不存在");
          error.status = 404;
          throw error;
        }
        const target = platformMockStore.alerts[index];
        if (target.alertStatus === "open") {
          target.alertStatus = "acked";
          target.ackedAt = new Date().toISOString();
        }
        return { ok: true, alertId, alertStatus: target.alertStatus };
      },
    });
    clearPlatformCache();
    return response;
  },
};

const interviewSessionApi = {
  createSession(payload) {
    return apiFetch(buildCanonicalApiUrl(), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getSession(sessionId) {
    return apiFetch(buildCanonicalApiUrl(`/${sessionId}`));
  },
  listQuestions(sessionId) {
    return apiFetch(buildCanonicalApiUrl(`/${sessionId}/questions`));
  },
  listAnswers(sessionId) {
    return apiFetch(buildCanonicalApiUrl(`/${sessionId}/answers`));
  },
  saveAnswer(sessionId, payload) {
    return apiFetch(buildCanonicalApiUrl(`/${sessionId}/answers`), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  finalize(sessionId, payload) {
    return apiFetch(buildCanonicalApiUrl(`/${sessionId}/finalize`), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getResultSummary(sessionId) {
    return apiFetch(buildCanonicalApiUrl(`/${sessionId}/result-summary`));
  },
};

function cleanupPage() {
  while (cleanupTasks.length > 0) {
    const task = cleanupTasks.pop();
    task();
  }
}

function navigate(pathname) {
  window.history.pushState({}, "", pathname);
  render();
}

function getRoute() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    return { name: "home" };
  }

  if (parts[0] === "platform") {
    if (parts.length === 1 || parts[1] === "overview") {
      return { name: "platform-overview" };
    }
    if (parts[1] === "runs" && parts[2]) {
      return {
        name: "platform-run-detail",
        runId: parts[2],
      };
    }
    if (parts[1] === "runs") {
      return { name: "platform-runs" };
    }
    if (parts[1] === "alerts") {
      return { name: "platform-alerts" };
    }
    return { name: "invalid" };
  }

  if (parts[0] === "session" && parts[1] === "invalid") {
    return { name: "invalid" };
  }

  if (parts[0] === "session" && parts[1] && parts[2]) {
    return {
      name: parts[2],
      sessionId: parts[1],
    };
  }

  return { name: "invalid" };
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const rawBody = await response.text();
  let data = {};

  if (rawBody) {
    try {
      data = JSON.parse(rawBody);
    } catch {
      data = { message: rawBody };
    }
  }

  state.lastRequestId = data.requestId ?? response.headers.get("x-request-id") ?? null;

  if (!response.ok) {
    const error = new Error(`${data.errorCode ?? "REQUEST_FAILED"}：${data.message ?? "请求失败"}`);
    error.status = response.status;
    error.errorCode = data.errorCode ?? "REQUEST_FAILED";
    throw error;
  }

  return data;
}

function getDraftKey(sessionId) {
  return `cloud-native:drafts:${sessionId}`;
}

function readLocalDrafts(sessionId) {
  try {
    return JSON.parse(localStorage.getItem(getDraftKey(sessionId)) ?? "{}");
  } catch {
    return {};
  }
}

function writeLocalDrafts(sessionId, drafts) {
  localStorage.setItem(getDraftKey(sessionId), JSON.stringify(drafts));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderRequestCard() {
  if (!state.lastRequestId) {
    return "";
  }

  return `
    <section class="request-card">
      <span class="badge">requestId</span>
      <div><code>${escapeHtml(state.lastRequestId)}</code></div>
    </section>
  `;
}

function bindNavigateButtons(root = document) {
  root.querySelectorAll("[data-navigate]").forEach((element) => {
    element.addEventListener("click", () => {
      const pathname = element.getAttribute("data-navigate");
      if (pathname) {
        navigate(pathname);
      }
    });
  });
}

function getRunsQueryFromLocation() {
  const searchParams = new URLSearchParams(window.location.search);
  return normalizeRunsQuery({
    engineType: searchParams.get("engineType"),
    runStatus: searchParams.get("runStatus"),
    slaTier: searchParams.get("slaTier"),
    queueName: searchParams.get("queueName"),
    page: searchParams.get("page"),
    pageSize: searchParams.get("pageSize"),
  });
}

function getAlertsQueryFromLocation() {
  const searchParams = new URLSearchParams(window.location.search);
  return normalizeAlertsQuery({
    alertSeverity: searchParams.get("alertSeverity"),
    runStatus: searchParams.get("runStatus"),
    page: searchParams.get("page"),
    pageSize: searchParams.get("pageSize"),
  });
}

function buildPathWithQuery(pathname, query) {
  const queryString = buildQueryString(query);
  return queryString ? `${pathname}?${queryString}` : pathname;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return String(value);
  }
  return date.toLocaleString();
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "-";
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${Math.round(value * 100)}%`;
}

function renderToneBadge(meta, fallbackText) {
  const label = meta?.label ?? fallbackText;
  const tone = meta?.tone ?? "neutral";
  return `<span class="tone-badge tone-${tone}">${escapeHtml(label)}</span>`;
}

function renderRunStatusBadge(runStatus) {
  return renderToneBadge(RUN_STATUS_META[runStatus], runStatus || "unknown");
}

function renderAlertStatusBadge(alertStatus) {
  return renderToneBadge(ALERT_STATUS_META[alertStatus], alertStatus || "unknown");
}

function renderAlertSeverityBadge(alertSeverity) {
  return renderToneBadge(ALERT_SEVERITY_META[alertSeverity], alertSeverity || "unknown");
}

function renderHealthBadge(status) {
  return renderToneBadge(HEALTH_STATUS_META[status], status || "unknown");
}

function renderPlatformModeNotice() {
  const modeText = state.platformMode === "mock" ? "Mock Fallback" : "Canonical API";
  const extraHint =
    state.platformMode === "mock"
      ? "当前为 mock 模式，待 /api/v1/platform 可用后会自动切回。"
      : "当前已连接 canonical platform API。";
  return `
    <section class="request-card">
      <span class="badge">platformMode</span>
      <div><code>${escapeHtml(modeText)}</code></div>
      <p class="meta">${escapeHtml(extraHint)}</p>
    </section>
  `;
}

function renderPlatformNav(activeRoute) {
  return `
    <section class="platform-nav">
      <button class="btn btn-secondary ${activeRoute === "platform-overview" ? "is-active" : ""}" data-navigate="/platform/overview">Overview</button>
      <button class="btn btn-secondary ${activeRoute === "platform-runs" ? "is-active" : ""}" data-navigate="/platform/runs">Runs</button>
      <button class="btn btn-secondary ${activeRoute === "platform-alerts" ? "is-active" : ""}" data-navigate="/platform/alerts">Alerts</button>
      <button class="btn btn-secondary" data-navigate="/">返回面试链路</button>
    </section>
  `;
}

function renderAsyncState({ title, description, actionText = "重试", actionPathname = window.location.pathname + window.location.search }) {
  return `
    <section class="panel">
      <h2>${escapeHtml(title)}</h2>
      <p class="meta">${escapeHtml(description)}</p>
      <div class="actions">
        <button class="btn btn-primary" data-navigate="${escapeHtml(actionPathname)}">${escapeHtml(actionText)}</button>
      </div>
    </section>
  `;
}

function renderGrafanaButton(grafana) {
  if (!state.permissions.canOpenGrafana) {
    return `<button class="btn btn-secondary" disabled>Grafana（无权限）</button>`;
  }

  const href = buildGrafanaHref(state.grafanaBaseUrl, grafana);
  if (!href) {
    return `<button class="btn btn-secondary" disabled>Grafana（未配置）</button>`;
  }

  return `<a class="btn btn-secondary" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">Grafana 深链</a>`;
}

function renderHome() {
  appElement.innerHTML = `
    <section class="layout">
      <section class="panel">
        <h2>启动说明</h2>
        <p>这个最小版使用 canonical API 适配层发起请求，可切换到 Go 后端而不依赖 Node 演示行为。</p>
        <div class="info-grid">
          <div>
            <strong>模式</strong>
            <p class="meta">Canonical API + 原生前端</p>
          </div>
          <div>
            <strong>样例数据</strong>
            <p class="meta">AI Infra 调度工程师模拟面试</p>
          </div>
          <div>
            <strong>关键字段</strong>
            <p class="meta">所有关键接口都会返回 requestId</p>
          </div>
          <div>
            <strong>当前 API Host</strong>
            <p class="meta"><code>${escapeHtml(formatApiBaseUrl())}</code></p>
          </div>
        </div>
        <p class="meta">默认同源接入当前 Host 的 canonical API（<code>npm run dev</code> 为 Go 主线）。仅在调试 fallback 时才需要 <code>?apiBaseUrl=http://127.0.0.1:3000</code>；传 <code>default</code> 恢复同源。</p>
        <div class="actions">
          <button id="start-session" class="btn btn-primary">创建演示会话</button>
          <button class="btn btn-secondary" data-navigate="/platform/overview">进入平台总览骨架</button>
        </div>
      </section>
      ${renderPlatformModeNotice()}
      ${renderRequestCard()}
    </section>
  `;
  bindNavigateButtons();

  document.querySelector("#start-session")?.addEventListener("click", async () => {
    const button = document.querySelector("#start-session");
    button.disabled = true;

    try {
      const payload = {
        candidateId: "cand_demo_001",
        interviewPlanId: "plan_aiinfra_mvp_001",
        mode: "live_interview",
        entryToken: "entry_demo_token",
      };

      const session = await interviewSessionApi.createSession(payload);

      state.session = session;
      navigate(`/session/${session.sessionId}/launch`);
    } catch (error) {
      button.disabled = false;
      alert(error.message);
    }
  });
}

async function renderPlatformOverview() {
  appElement.innerHTML = `
    <section class="layout">
      ${renderPlatformNav("platform-overview")}
      ${renderAsyncState({ title: "平台总览", description: "正在加载 overview..." })}
      ${renderPlatformModeNotice()}
      ${renderRequestCard()}
    </section>
  `;
  bindNavigateButtons();

  try {
    const overview = await platformApi.getOverview();

    appElement.innerHTML = `
      <section class="layout">
        ${renderPlatformNav("platform-overview")}
        <section class="panel">
          <h2>平台总览 / Overview</h2>
          <p class="meta">聚合健康态、队列容量与 24h SLA 违约摘要。</p>
          <div class="info-grid">
            <div>
              <strong>Control Plane</strong>
              <p>${renderHealthBadge(overview.controlPlaneHealth)}</p>
            </div>
            <div>
              <strong>Runtime</strong>
              <p>${renderHealthBadge(overview.runtimeHealth)}</p>
            </div>
            <div>
              <strong>Alerts</strong>
              <p>${renderHealthBadge(overview.alertHealth)}</p>
            </div>
            <div>
              <strong>SLA Breach 24h</strong>
              <p class="meta">${escapeHtml(overview.slaBreachCount24h)}</p>
            </div>
          </div>
          <h3>Queue Utilization</h3>
          ${
            overview.queueUtilization?.length
              ? `
                <div class="table-wrap">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Queue</th>
                        <th>SLA Tier</th>
                        <th>Pending</th>
                        <th>Running</th>
                        <th>Utilization</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${overview.queueUtilization
                        .map(
                          (item) => `
                            <tr>
                              <td>${escapeHtml(item.queueName)}</td>
                              <td>${escapeHtml(item.slaTier)}</td>
                              <td>${escapeHtml(item.pendingDepth)}</td>
                              <td>${escapeHtml(item.runningCount)}</td>
                              <td>${escapeHtml(formatPercent(item.utilizationRatio))}</td>
                            </tr>
                          `,
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              `
              : `<p class="meta">暂无队列数据。</p>`
          }
          <p class="meta">generatedAt：${escapeHtml(formatDateTime(overview.generatedAt))}</p>
        </section>
        ${renderPlatformModeNotice()}
        ${renderRequestCard()}
      </section>
    `;
    bindNavigateButtons();
  } catch (error) {
    appElement.innerHTML = `
      <section class="layout">
        ${renderPlatformNav("platform-overview")}
        ${renderAsyncState({
          title: "平台总览加载失败",
          description: error.message,
          actionText: "重试总览",
          actionPathname: "/platform/overview",
        })}
        ${renderPlatformModeNotice()}
        ${renderRequestCard()}
      </section>
    `;
    bindNavigateButtons();
  }
}

function renderRunsFilterForm(query) {
  return `
    <form id="runs-filter-form" class="filter-bar">
      <label>
        Engine
        <select name="engineType">
          <option value="">全部</option>
          ${ENGINE_TYPE_VALUES.map(
            (value) =>
              `<option value="${value}" ${query.engineType === value ? "selected" : ""}>${value.toUpperCase()}</option>`,
          ).join("")}
        </select>
      </label>
      <label>
        Status
        <select name="runStatus">
          <option value="">全部</option>
          ${RUN_STATUS_VALUES.map(
            (value) =>
              `<option value="${value}" ${query.runStatus === value ? "selected" : ""}>${escapeHtml(
                RUN_STATUS_META[value]?.label ?? value,
              )}</option>`,
          ).join("")}
        </select>
      </label>
      <label>
        SLA
        <select name="slaTier">
          <option value="">全部</option>
          ${SLA_TIER_VALUES.map(
            (value) =>
              `<option value="${value}" ${query.slaTier === value ? "selected" : ""}>${value.toUpperCase()}</option>`,
          ).join("")}
        </select>
      </label>
      <label>
        Queue
        <input type="text" name="queueName" value="${escapeHtml(query.queueName)}" placeholder="prod-realtime" />
      </label>
      <label>
        Page Size
        <select name="pageSize">
          ${[10, 20, 50, 100]
            .map((value) => `<option value="${value}" ${query.pageSize === value ? "selected" : ""}>${value}</option>`)
            .join("")}
        </select>
      </label>
      <button class="btn btn-primary" type="submit">应用筛选</button>
    </form>
  `;
}

async function renderPlatformRuns() {
  const query = getRunsQueryFromLocation();

  appElement.innerHTML = `
    <section class="layout">
      ${renderPlatformNav("platform-runs")}
      ${renderAsyncState({ title: "作业运行列表", description: "正在加载 runs..." })}
      ${renderPlatformModeNotice()}
      ${renderRequestCard()}
    </section>
  `;
  bindNavigateButtons();

  try {
    const result = await platformApi.listRuns(query);
    const totalPages = Math.max(1, Math.ceil((result.total ?? 0) / query.pageSize));
    const safePage = Math.min(query.page, totalPages);

    appElement.innerHTML = `
      <section class="layout">
        ${renderPlatformNav("platform-runs")}
        <section class="panel">
          <h2>作业运行页 / Runs</h2>
          <p class="meta">按引擎、状态、SLA、队列过滤。点击 run 进入详情并可跳 Grafana。</p>
          ${renderRunsFilterForm({ ...query, page: safePage })}
          ${
            result.items?.length
              ? `
                <div class="table-wrap">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Run</th>
                        <th>Engine</th>
                        <th>Status</th>
                        <th>Queue</th>
                        <th>SLA</th>
                        <th>Owner</th>
                        <th>Duration</th>
                        <th>Ops</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${result.items
                        .map(
                          (item) => `
                            <tr>
                              <td><code>${escapeHtml(item.runId)}</code></td>
                              <td>${escapeHtml(item.engineType)}</td>
                              <td>${renderRunStatusBadge(item.runStatus)}</td>
                              <td>${escapeHtml(item.queueName)}</td>
                              <td>${escapeHtml(item.slaTier)}</td>
                              <td>${escapeHtml(item.owner ?? "-")}</td>
                              <td>${escapeHtml(formatDuration(item.durationMs))}</td>
                              <td>
                                <div class="inline-actions">
                                  <button class="btn btn-secondary" data-navigate="/platform/runs/${escapeHtml(item.runId)}">详情</button>
                                  ${renderGrafanaButton(item.grafana)}
                                </div>
                              </td>
                            </tr>
                          `,
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              `
              : `<p class="meta">暂无符合条件的运行记录。</p>`
          }
          <div class="pagination-bar">
            <span class="meta">共 ${escapeHtml(result.total ?? 0)} 条，当前第 ${safePage}/${totalPages} 页</span>
            <div class="inline-actions">
              <button class="btn btn-secondary" data-runs-page="${safePage - 1}" ${safePage <= 1 ? "disabled" : ""}>上一页</button>
              <button class="btn btn-secondary" data-runs-page="${safePage + 1}" ${safePage >= totalPages ? "disabled" : ""}>下一页</button>
            </div>
          </div>
        </section>
        ${renderPlatformModeNotice()}
        ${renderRequestCard()}
      </section>
    `;
    bindNavigateButtons();

    const runsFilterForm = document.querySelector("#runs-filter-form");
    runsFilterForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(runsFilterForm);
      const nextQuery = normalizeRunsQuery({
        engineType: formData.get("engineType"),
        runStatus: formData.get("runStatus"),
        slaTier: formData.get("slaTier"),
        queueName: formData.get("queueName"),
        page: 1,
        pageSize: formData.get("pageSize"),
      });
      navigate(buildPathWithQuery("/platform/runs", nextQuery));
    });

    document.querySelectorAll("[data-runs-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextPage = Number.parseInt(button.getAttribute("data-runs-page"), 10);
        const nextQuery = normalizeRunsQuery({
          ...query,
          page: nextPage,
        });
        navigate(buildPathWithQuery("/platform/runs", nextQuery));
      });
    });
  } catch (error) {
    appElement.innerHTML = `
      <section class="layout">
        ${renderPlatformNav("platform-runs")}
        ${renderAsyncState({
          title: "运行列表加载失败",
          description: error.message,
          actionText: "重试 runs",
          actionPathname: buildPathWithQuery("/platform/runs", query),
        })}
        ${renderPlatformModeNotice()}
        ${renderRequestCard()}
      </section>
    `;
    bindNavigateButtons();
  }
}

async function renderPlatformRunDetail(runId) {
  appElement.innerHTML = `
    <section class="layout">
      ${renderPlatformNav("platform-runs")}
      ${renderAsyncState({ title: "运行详情", description: "正在加载 run detail..." })}
      ${renderPlatformModeNotice()}
      ${renderRequestCard()}
    </section>
  `;
  bindNavigateButtons();

  try {
    const detail = await platformApi.getRunDetail(runId);
    appElement.innerHTML = `
      <section class="layout">
        ${renderPlatformNav("platform-runs")}
        <section class="panel">
          <h2>运行详情 / ${escapeHtml(detail.runId)}</h2>
          <div class="info-grid">
            <div><strong>Engine</strong><p class="meta">${escapeHtml(detail.engineType)}</p></div>
            <div><strong>Status</strong><p>${renderRunStatusBadge(detail.runStatus)}</p></div>
            <div><strong>Queue</strong><p class="meta">${escapeHtml(detail.queueName)}</p></div>
            <div><strong>SLA</strong><p class="meta">${escapeHtml(detail.slaTier)}</p></div>
            <div><strong>Start</strong><p class="meta">${escapeHtml(formatDateTime(detail.startTime))}</p></div>
            <div><strong>End</strong><p class="meta">${escapeHtml(formatDateTime(detail.endTime))}</p></div>
            <div><strong>Duration</strong><p class="meta">${escapeHtml(formatDuration(detail.durationMs))}</p></div>
            <div><strong>Retry</strong><p class="meta">${escapeHtml(detail.retryCount ?? "-")}</p></div>
          </div>
          <div class="actions">
            <button class="btn btn-secondary" data-navigate="/platform/runs">返回列表</button>
            ${renderGrafanaButton(detail.grafana)}
          </div>
          ${
            detail.failureReason
              ? `
                <section class="summary-card">
                  <h3>失败信息</h3>
                  <p><strong>failureCode:</strong> <code>${escapeHtml(detail.failureCode ?? "-")}</code></p>
                  <p>${escapeHtml(detail.failureReason)}</p>
                </section>
              `
              : ""
          }
          <section class="summary-card">
            <h3>运行事件时间线</h3>
            ${
              detail.events?.length
                ? `
                  <ul>
                    ${detail.events
                      .map(
                        (event) => `
                          <li>
                            <strong>${escapeHtml(formatDateTime(event.eventTime))}</strong>
                            <div>${escapeHtml(event.eventType)}：${escapeHtml(event.message)}</div>
                          </li>
                        `,
                      )
                      .join("")}
                  </ul>
                `
                : "<p class='meta'>暂无事件。</p>"
            }
          </section>
        </section>
        ${renderPlatformModeNotice()}
        ${renderRequestCard()}
      </section>
    `;
    bindNavigateButtons();
  } catch (error) {
    appElement.innerHTML = `
      <section class="layout">
        ${renderPlatformNav("platform-runs")}
        ${renderAsyncState({
          title: "运行详情加载失败",
          description: error.message,
          actionText: "返回 runs",
          actionPathname: "/platform/runs",
        })}
        ${renderPlatformModeNotice()}
        ${renderRequestCard()}
      </section>
    `;
    bindNavigateButtons();
  }
}

function renderAlertsFilterForm(query) {
  return `
    <form id="alerts-filter-form" class="filter-bar">
      <label>
        Severity
        <select name="alertSeverity">
          <option value="">全部</option>
          ${ALERT_SEVERITY_VALUES.map(
            (value) =>
              `<option value="${value}" ${query.alertSeverity === value ? "selected" : ""}>${value.toUpperCase()}</option>`,
          ).join("")}
        </select>
      </label>
      <label>
        Related Run Status
        <select name="runStatus">
          <option value="">全部</option>
          ${RUN_STATUS_VALUES.map(
            (value) =>
              `<option value="${value}" ${query.runStatus === value ? "selected" : ""}>${escapeHtml(
                RUN_STATUS_META[value]?.label ?? value,
              )}</option>`,
          ).join("")}
        </select>
      </label>
      <label>
        Page Size
        <select name="pageSize">
          ${[10, 20, 50, 100]
            .map((value) => `<option value="${value}" ${query.pageSize === value ? "selected" : ""}>${value}</option>`)
            .join("")}
        </select>
      </label>
      <button class="btn btn-primary" type="submit">应用筛选</button>
    </form>
  `;
}

async function renderPlatformAlerts() {
  const query = getAlertsQueryFromLocation();

  appElement.innerHTML = `
    <section class="layout">
      ${renderPlatformNav("platform-alerts")}
      ${renderAsyncState({ title: "告警中心", description: "正在加载 alerts..." })}
      ${renderPlatformModeNotice()}
      ${renderRequestCard()}
    </section>
  `;
  bindNavigateButtons();

  try {
    const result = await platformApi.listAlerts(query);
    const totalPages = Math.max(1, Math.ceil((result.total ?? 0) / query.pageSize));
    const safePage = Math.min(query.page, totalPages);

    appElement.innerHTML = `
      <section class="layout">
        ${renderPlatformNav("platform-alerts")}
        <section class="panel">
          <h2>告警中心 / Alerts</h2>
          <p class="meta">支持按告警等级与关联 run 状态筛选，并执行 ACK。</p>
          ${renderAlertsFilterForm({ ...query, page: safePage })}
          ${
            result.items?.length
              ? `
                <div class="table-wrap">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Alert</th>
                        <th>Severity</th>
                        <th>Status</th>
                        <th>Source</th>
                        <th>Summary</th>
                        <th>Triggered</th>
                        <th>Ops</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${result.items
                        .map(
                          (item) => `
                            <tr>
                              <td><code>${escapeHtml(item.alertId)}</code></td>
                              <td>${renderAlertSeverityBadge(item.alertSeverity)}</td>
                              <td>${renderAlertStatusBadge(item.alertStatus)}</td>
                              <td>${escapeHtml(item.sourceType)} / ${escapeHtml(item.sourceId)}</td>
                              <td>
                                <div>${escapeHtml(item.summary)}</div>
                                ${
                                  item.relatedRunId
                                    ? `<small class="muted">run: <code>${escapeHtml(item.relatedRunId)}</code></small>`
                                    : ""
                                }
                              </td>
                              <td>${escapeHtml(formatDateTime(item.triggeredAt))}</td>
                              <td>
                                <div class="inline-actions">
                                  <button class="btn btn-secondary" data-ack-alert="${escapeHtml(item.alertId)}" ${
                                    !state.permissions.canAckAlert || item.alertStatus !== "open" ? "disabled" : ""
                                  }>
                                    ${
                                      !state.permissions.canAckAlert
                                        ? "ACK（无权限）"
                                        : item.alertStatus === "open"
                                          ? "ACK"
                                          : "已处理"
                                    }
                                  </button>
                                  ${item.relatedRunId ? `<button class="btn btn-secondary" data-navigate="/platform/runs/${escapeHtml(item.relatedRunId)}">关联 Run</button>` : ""}
                                  ${renderGrafanaButton(item.grafana)}
                                </div>
                              </td>
                            </tr>
                          `,
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              `
              : "<p class='meta'>暂无符合条件的告警。</p>"
          }
          <div class="pagination-bar">
            <span class="meta">共 ${escapeHtml(result.total ?? 0)} 条，当前第 ${safePage}/${totalPages} 页</span>
            <div class="inline-actions">
              <button class="btn btn-secondary" data-alerts-page="${safePage - 1}" ${safePage <= 1 ? "disabled" : ""}>上一页</button>
              <button class="btn btn-secondary" data-alerts-page="${safePage + 1}" ${safePage >= totalPages ? "disabled" : ""}>下一页</button>
            </div>
          </div>
        </section>
        ${renderPlatformModeNotice()}
        ${renderRequestCard()}
      </section>
    `;
    bindNavigateButtons();

    const alertsFilterForm = document.querySelector("#alerts-filter-form");
    alertsFilterForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(alertsFilterForm);
      const nextQuery = normalizeAlertsQuery({
        alertSeverity: formData.get("alertSeverity"),
        runStatus: formData.get("runStatus"),
        page: 1,
        pageSize: formData.get("pageSize"),
      });
      navigate(buildPathWithQuery("/platform/alerts", nextQuery));
    });

    document.querySelectorAll("[data-alerts-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextPage = Number.parseInt(button.getAttribute("data-alerts-page"), 10);
        const nextQuery = normalizeAlertsQuery({
          ...query,
          page: nextPage,
        });
        navigate(buildPathWithQuery("/platform/alerts", nextQuery));
      });
    });

    document.querySelectorAll("[data-ack-alert]").forEach((button) => {
      button.addEventListener("click", async () => {
        const alertId = button.getAttribute("data-ack-alert");
        if (!alertId) {
          return;
        }
        button.disabled = true;
        try {
          await platformApi.ackAlert(alertId);
          render();
        } catch (error) {
          button.disabled = false;
          alert(error.message);
        }
      });
    });
  } catch (error) {
    appElement.innerHTML = `
      <section class="layout">
        ${renderPlatformNav("platform-alerts")}
        ${renderAsyncState({
          title: "告警列表加载失败",
          description: error.message,
          actionText: "重试 alerts",
          actionPathname: buildPathWithQuery("/platform/alerts", query),
        })}
        ${renderPlatformModeNotice()}
        ${renderRequestCard()}
      </section>
    `;
    bindNavigateButtons();
  }
}

function renderStatusBanner(status, description) {
  return `
    <section class="status-banner status-${status}">
      <strong>当前状态：${escapeHtml(status)}</strong>
      <div class="muted">${escapeHtml(description)}</div>
    </section>
  `;
}

function describeStatus(status) {
  switch (status) {
    case "pending":
      return "会话已创建，等待进入准备态。";
    case "preparing":
      return "系统正在固化题单并准备会话上下文。";
    case "in_progress":
      return "会话已可答题，即将跳转到面试页。";
    case "submitted":
      return "答案已提交，正在等待面试官面评完成。";
    case "completed":
      return "结果摘要已可查看。";
    default:
      return "请检查当前状态。";
  }
}

async function renderLaunch(sessionId) {
  appElement.innerHTML = `
    <section class="layout">
      <section class="panel">
        <h2>启动页</h2>
        <p class="meta">页面会轮询会话状态，并在进入 <code>in_progress</code> 后自动跳转。</p>
        <div id="launch-status"></div>
        ${renderRequestCard()}
      </section>
    </section>
  `;

  const statusElement = document.querySelector("#launch-status");

  async function refreshStatus() {
    try {
      const session = await interviewSessionApi.getSession(sessionId);
      state.session = session;
      statusElement.innerHTML = `
        ${renderStatusBanner(session.status, describeStatus(session.status))}
        <div class="info-grid">
          <div>
            <strong>sessionId</strong>
            <p class="meta">${escapeHtml(session.sessionId)}</p>
          </div>
          <div>
            <strong>questionSetPolicyResolved</strong>
            <p class="meta">${escapeHtml(session.questionSetPolicyResolved)}</p>
          </div>
          <div>
            <strong>progress</strong>
            <p class="meta">${session.progress.answeredCount}/${session.progress.totalCount}</p>
          </div>
        </div>
        ${renderRequestCard()}
      `;

      if (session.status === "in_progress") {
        setTimeout(() => navigate(`/session/${sessionId}/interview`), 600);
      }
    } catch (error) {
      statusElement.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  }

  await refreshStatus();
  const timer = window.setInterval(refreshStatus, 1600);
  cleanupTasks.push(() => window.clearInterval(timer));
}

function readAnswerValue(sessionId, questionId) {
  const drafts = readLocalDrafts(sessionId);
  return drafts[questionId] ?? state.answers[questionId]?.answerContent ?? "";
}

async function saveAnswer(sessionId, questionId, answerContent, saveMode) {
  const idempotencyKey = `${questionId}:${saveMode}:${Date.now()}`;
  const response = await interviewSessionApi.saveAnswer(sessionId, {
    questionId,
    answerContent,
    answerFormat: "plain_text",
    clientSavedAt: new Date().toISOString(),
    idempotencyKey,
  });

  state.answers[questionId] = {
    questionId,
    answerContent,
    answerVersion: response.answerVersion,
    savedAt: response.savedAt,
  };

  const drafts = readLocalDrafts(sessionId);
  drafts[questionId] = answerContent;
  writeLocalDrafts(sessionId, drafts);
  state.lastSaveMessage = `已保存：${new Date(response.savedAt).toLocaleTimeString()}`;
}

async function loadInterviewData(sessionId) {
  const [session, questionData, answerData] = await Promise.all([
    interviewSessionApi.getSession(sessionId),
    interviewSessionApi.listQuestions(sessionId),
    interviewSessionApi.listAnswers(sessionId),
  ]);

  state.session = session;
  state.questions = questionData.questions;
  state.answers = Object.fromEntries(answerData.answers.map((answer) => [answer.questionId, answer]));
  state.currentQuestionId = state.currentQuestionId ?? state.questions[0]?.questionId ?? null;
}

async function renderInterview(sessionId) {
  await loadInterviewData(sessionId);

  if (state.session.status === "completed" || state.session.status === "submitted") {
    navigate(`/session/${sessionId}/finish`);
    return;
  }

  if (state.session.status !== "in_progress") {
    navigate(`/session/${sessionId}/launch`);
    return;
  }

  const currentQuestion =
    state.questions.find((question) => question.questionId === state.currentQuestionId) ?? state.questions[0];

  appElement.innerHTML = `
    <section class="layout">
      ${renderStatusBanner("in_progress", "会话已进入答题阶段，可保存草稿并提交。")}
      <section class="interview-layout">
        <aside class="question-nav" id="question-nav"></aside>
        <section class="panel question-card">
          <div class="toolbar">
            <div>
              <strong>当前题目</strong>
              <div class="meta">${escapeHtml(currentQuestion.title)}</div>
            </div>
            <div>
              <strong>进度</strong>
              <div class="meta">${state.session.progress.answeredCount}/${state.session.progress.totalCount}</div>
            </div>
            <div>
              <strong>保存状态</strong>
              <div class="meta">${escapeHtml(state.lastSaveMessage || "尚未保存")}</div>
            </div>
          </div>
          <h2>${escapeHtml(currentQuestion.title)}</h2>
          <p>${escapeHtml(currentQuestion.stem)}</p>
          <ul>
            ${currentQuestion.constraints.map((constraint) => `<li>${escapeHtml(constraint)}</li>`).join("")}
          </ul>
          <textarea id="answer-input" placeholder="输入本题回答...">${escapeHtml(
            readAnswerValue(sessionId, currentQuestion.questionId),
          )}</textarea>
          <div class="actions">
            <button id="save-answer" class="btn btn-secondary">保存当前回答</button>
            <button id="prev-question" class="btn btn-secondary">上一题</button>
            <button id="next-question" class="btn btn-secondary">下一题</button>
            <button id="go-finish" class="btn btn-primary">进入结束页</button>
          </div>
          ${renderRequestCard()}
        </section>
      </section>
    </section>
  `;

  const navElement = document.querySelector("#question-nav");
  navElement.innerHTML = state.questions
    .map((question) => {
      const answer = state.answers[question.questionId];
      const statusText = answer?.savedAt ? "已保存" : "待作答";
      return `
        <button data-question-id="${escapeHtml(question.questionId)}" class="${
          question.questionId === currentQuestion.questionId ? "active" : ""
        }">
          <strong>Q${question.sequenceNo}</strong>
          <div>${escapeHtml(question.title)}</div>
          <small>${escapeHtml(statusText)}</small>
        </button>
      `;
    })
    .join("");

  navElement.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentQuestionId = button.dataset.questionId;
      render();
    });
  });

  const answerInput = document.querySelector("#answer-input");
  let saveTimer = null;

  answerInput.addEventListener("input", () => {
    const drafts = readLocalDrafts(sessionId);
    drafts[currentQuestion.questionId] = answerInput.value;
    writeLocalDrafts(sessionId, drafts);

    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      try {
        await saveAnswer(sessionId, currentQuestion.questionId, answerInput.value, "auto");
        render();
      } catch (error) {
        state.lastSaveMessage = error.message;
        render();
      }
    }, 1200);
  });
  cleanupTasks.push(() => window.clearTimeout(saveTimer));

  document.querySelector("#save-answer")?.addEventListener("click", async () => {
    try {
      await saveAnswer(sessionId, currentQuestion.questionId, answerInput.value, "manual");
      render();
    } catch (error) {
      alert(error.message);
    }
  });

  const currentIndex = state.questions.findIndex((question) => question.questionId === currentQuestion.questionId);

  document.querySelector("#prev-question")?.addEventListener("click", () => {
    const previousQuestion = state.questions[currentIndex - 1];
    if (previousQuestion) {
      state.currentQuestionId = previousQuestion.questionId;
      render();
    }
  });

  document.querySelector("#next-question")?.addEventListener("click", () => {
    const nextQuestion = state.questions[currentIndex + 1];
    if (nextQuestion) {
      state.currentQuestionId = nextQuestion.questionId;
      render();
    }
  });

  document.querySelector("#go-finish")?.addEventListener("click", () => {
    navigate(`/session/${sessionId}/finish`);
  });
}

async function finalizeSession(sessionId) {
  const response = await interviewSessionApi.finalize(sessionId, {
    finalizedAt: new Date().toISOString(),
    idempotencyKey: `finalize:${sessionId}`,
  });

  state.session = { ...state.session, status: response.status };
  return response;
}

async function loadSummary(sessionId) {
  state.resultSummary = await interviewSessionApi.getResultSummary(sessionId);
}

async function renderFinish(sessionId) {
  state.resultSummary = null;
  const session = await interviewSessionApi.getSession(sessionId);
  state.session = session;

  if (session.status === "pending" || session.status === "preparing") {
    navigate(`/session/${sessionId}/launch`);
    return;
  }

  if (session.status === "completed") {
    await loadSummary(sessionId);
  }

  const displayStatus = state.resultSummary?.status ?? session.status;
  const canFinalize = session.status === "in_progress";
  const canReturnInterview = session.status === "in_progress";
  let finalizeButtonText = "确认提交并进入待面评";
  if (session.status === "submitted") {
    finalizeButtonText = "已提交（等待面评）";
  }
  if (session.status === "completed") {
    finalizeButtonText = "面评完成";
  }

  appElement.innerHTML = `
    <section class="layout">
      ${renderStatusBanner(displayStatus, describeStatus(displayStatus))}
      <section class="panel">
        <h2>结束页</h2>
        <div class="info-grid">
          <div>
            <strong>sessionId</strong>
            <p class="meta">${escapeHtml(session.sessionId)}</p>
          </div>
          <div>
            <strong>题目数</strong>
            <p class="meta">${session.progress.answeredCount}/${session.progress.totalCount}</p>
          </div>
          <div>
            <strong>状态</strong>
            <p class="meta">${escapeHtml(displayStatus)}</p>
          </div>
        </div>
        <div class="actions">
          <button id="finalize-session" class="btn btn-primary" ${canFinalize ? "" : "disabled"}>${escapeHtml(
            finalizeButtonText,
          )}</button>
          <button id="back-interview" class="btn btn-secondary" ${canReturnInterview ? "" : "disabled"}>返回答题页</button>
        </div>
      </section>
      ${
        session.status === "submitted"
          ? `
            <section class="summary-card">
              <h3>待面评</h3>
              <p>候选人答案已提交，当前处于 <code>submitted</code> 状态。面试官提交面评后会进入 <code>completed</code> 并展示结果摘要。</p>
            </section>
          `
          : ""
      }
      ${
        state.resultSummary
          ? `
            <section class="summary-card">
              <h3>结果摘要</h3>
              <p>${escapeHtml(state.resultSummary.summary)}</p>
              <p><strong>建议：</strong>${escapeHtml(state.resultSummary.hireRecommendation)}</p>
              <p><strong>维度分：</strong></p>
              <ul>
                ${state.resultSummary.dimensionScores
                  .map((item) => `<li>${escapeHtml(item.dimension)}：${escapeHtml(item.score)}</li>`)
                  .join("")}
              </ul>
              <p><strong>风险标签：</strong>${state.resultSummary.riskTags.map(escapeHtml).join("、")}</p>
            </section>
          `
          : ""
      }
      ${
        session.status === "completed" && !state.resultSummary
          ? `
            <section class="summary-card">
              <h3>结果摘要暂不可读</h3>
              <p>会话状态已是 <code>completed</code>，但结果摘要接口暂未返回内容，请稍后刷新重试。</p>
            </section>
          `
          : ""
      }
      ${renderRequestCard()}
    </section>
  `;

  if (canFinalize) {
    document.querySelector("#finalize-session")?.addEventListener("click", async () => {
      try {
        await finalizeSession(sessionId);
        render();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  if (canReturnInterview) {
    document.querySelector("#back-interview")?.addEventListener("click", () => {
      navigate(`/session/${sessionId}/interview`);
    });
  }
}

function renderInvalid() {
  appElement.innerHTML = `
    <section class="panel">
      <h2>无效会话</h2>
      <p class="meta">当前链接无效或会话不存在，请重新从首页创建演示会话。</p>
      <div class="actions">
        <button id="go-home" class="btn btn-primary">返回首页</button>
      </div>
    </section>
  `;

  document.querySelector("#go-home")?.addEventListener("click", () => navigate("/"));
}

async function render() {
  cleanupPage();
  const route = getRoute();

  try {
    if (route.name === "home") {
      renderHome();
      return;
    }

    if (route.name === "platform-overview") {
      await renderPlatformOverview();
      return;
    }

    if (route.name === "platform-runs") {
      await renderPlatformRuns();
      return;
    }

    if (route.name === "platform-run-detail") {
      await renderPlatformRunDetail(route.runId);
      return;
    }

    if (route.name === "platform-alerts") {
      await renderPlatformAlerts();
      return;
    }

    if (route.name === "launch") {
      await renderLaunch(route.sessionId);
      return;
    }

    if (route.name === "interview") {
      await renderInterview(route.sessionId);
      return;
    }

    if (route.name === "finish") {
      await renderFinish(route.sessionId);
      return;
    }

    renderInvalid();
  } catch (error) {
    appElement.innerHTML = `
      <section class="panel">
        <h2>页面异常</h2>
        <p class="meta">${escapeHtml(error.message)}</p>
        ${renderRequestCard()}
        <div class="actions">
          <button id="retry-render" class="btn btn-primary">重试</button>
        </div>
      </section>
    `;

    document.querySelector("#retry-render")?.addEventListener("click", () => render());
  }
}

resolveApiBaseUrl();
resolveGrafanaBaseUrl();
resolvePermissions();
window.addEventListener("popstate", render);
render();
