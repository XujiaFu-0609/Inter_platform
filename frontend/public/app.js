const state = {
  session: null,
  questions: [],
  answers: {},
  currentQuestionId: null,
  lastRequestId: null,
  lastSaveMessage: "",
  resultSummary: null,
  apiBaseUrl: "",
};

const CANONICAL_API_BASE_PATH = "/api/v1/interview-sessions";
const API_BASE_URL_STORAGE_KEY = "cloud-native:api-base-url";
const cleanupTasks = [];
const appElement = document.querySelector("#app");

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

function formatApiBaseUrl() {
  return state.apiBaseUrl || window.location.origin;
}

function buildCanonicalApiUrl(pathname = "") {
  return `${state.apiBaseUrl}${CANONICAL_API_BASE_PATH}${pathname}`;
}

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
    throw new Error(`${data.errorCode ?? "REQUEST_FAILED"}：${data.message ?? "请求失败"}`);
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
        </div>
      </section>
      ${renderRequestCard()}
    </section>
  `;

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
window.addEventListener("popstate", render);
render();
