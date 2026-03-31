import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(__dirname, "public");
const fixturePath = path.join(rootDir, "data", "demo-fixtures.json");
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));
const sessions = new Map();
const idempotencyRecords = new Map();
let sessionCounter = 1;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function createRequestId() {
  return `req_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

function hashPayload(payload) {
  return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

function sendJson(response, statusCode, payload, requestId) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
  });
  response.end(JSON.stringify({ requestId, ...payload }, null, 2));
}

function sendError(response, statusCode, requestId, errorCode, message) {
  sendJson(response, statusCode, { errorCode, message }, requestId);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

function buildSessionId() {
  const suffix = String(sessionCounter++).padStart(3, "0");
  return `sess_demo_20260327_${suffix}`;
}

function buildTimeline(session) {
  return {
    createdAt: session.createdAt,
    preparingAt: session.preparingAt,
    startedAt: session.startedAt,
    submittedAt: session.submittedAt,
    completedAt: session.completedAt,
  };
}

function buildProgress(session) {
  const answeredCount = [...session.answers.values()].filter(
    (answer) => answer.answerContent.trim().length > 0,
  ).length;

  return {
    answeredCount,
    totalCount: fixtures.questions.length,
  };
}

function buildSessionResponse(session) {
  return {
    sessionId: session.sessionId,
    candidateId: session.candidateId,
    interviewPlanId: session.interviewPlanId,
    mode: session.mode,
    status: session.status,
    timeline: buildTimeline(session),
    progress: buildProgress(session),
    remainingResumeCount: 1,
    resumeDeadlineAt: null,
    resultAvailable: session.status === "completed",
    questionSetPolicyResolved: fixtures.interviewPlan.questionSetPolicyResolved,
    candidate: fixtures.candidate,
    interviewPlan: fixtures.interviewPlan,
  };
}

function ensureSession(sessionId) {
  return sessions.get(sessionId) ?? null;
}

function maybeAdvanceSession(session) {
  if (session.status === "pending") {
    session.pollCount += 1;
    if (session.pollCount >= 1) {
      session.status = "preparing";
      session.preparingAt = new Date().toISOString();
    }
    return;
  }

  if (session.status === "preparing") {
    session.pollCount += 1;
    if (session.pollCount >= 2) {
      session.status = "in_progress";
      session.startedAt = new Date().toISOString();
    }
  }
}

function assertIdempotency({ sessionId, routeKey, actorKey, idempotencyKey, payload, responsePayload }) {
  const recordKey = `${sessionId}:${routeKey}:${actorKey}:${idempotencyKey}`;
  const payloadHash = hashPayload(payload);
  const existingRecord = idempotencyRecords.get(recordKey);

  if (!existingRecord) {
    idempotencyRecords.set(recordKey, {
      payloadHash,
      responsePayload,
    });
    return { ok: true, replay: false };
  }

  if (existingRecord.payloadHash !== payloadHash) {
    return { ok: false, replay: false };
  }

  return { ok: true, replay: true, responsePayload: existingRecord.responsePayload };
}

function createSessionRecord(payload) {
  const createdAt = new Date().toISOString();
  return {
    sessionId: buildSessionId(),
    candidateId: payload.candidateId,
    interviewPlanId: payload.interviewPlanId,
    mode: payload.mode,
    entryToken: payload.entryToken ?? null,
    status: "pending",
    createdAt,
    preparingAt: null,
    startedAt: null,
    submittedAt: null,
    completedAt: null,
    pollCount: 0,
    answers: new Map(),
  };
}

async function serveStaticFile(requestPath, response) {
  const requestedPath = requestPath === "/" ? "/index.html" : requestPath;
  const normalizedPath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const candidatePath = path.join(publicDir, normalizedPath);

  if (existsSync(candidatePath)) {
    const fileStats = await stat(candidatePath);
    if (fileStats.isFile()) {
      const ext = path.extname(candidatePath);
      const body = await readFile(candidatePath);
      response.writeHead(200, {
        "content-type": contentTypes[ext] ?? "application/octet-stream",
      });
      response.end(body);
      return true;
    }
  }

  if (!path.extname(requestPath)) {
    const body = await readFile(path.join(publicDir, "index.html"));
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
    });
    response.end(body);
    return true;
  }

  return false;
}

async function handleApi(request, response, url) {
  const requestId = createRequestId();
  const method = request.method ?? "GET";
  const pathname = url.pathname;
  const sessionMatch = pathname.match(/^\/api\/v1\/interview-sessions\/([^/]+)$/);
  const questionsMatch = pathname.match(/^\/api\/v1\/interview-sessions\/([^/]+)\/questions$/);
  const answersMatch = pathname.match(/^\/api\/v1\/interview-sessions\/([^/]+)\/answers$/);
  const finalizeMatch = pathname.match(/^\/api\/v1\/interview-sessions\/([^/]+)\/finalize$/);
  const summaryMatch = pathname.match(/^\/api\/v1\/interview-sessions\/([^/]+)\/result-summary$/);

  if (method === "GET" && pathname === "/healthz") {
    sendJson(response, 200, { ok: true }, requestId);
    return;
  }

  if (method === "POST" && pathname === "/api/v1/interview-sessions") {
    const payload = await readJsonBody(request);
    if (!payload) {
      sendError(response, 400, requestId, "INVALID_JSON", "请求体不是合法 JSON。");
      return;
    }

    if (!payload.candidateId || !payload.interviewPlanId || !payload.mode) {
      sendError(response, 400, requestId, "VALIDATION_ERROR", "缺少 candidateId、interviewPlanId 或 mode。");
      return;
    }

    const session = createSessionRecord(payload);
    sessions.set(session.sessionId, session);
    sendJson(response, 201, buildSessionResponse(session), requestId);
    return;
  }

  if (sessionMatch && method === "GET") {
    const session = ensureSession(sessionMatch[1]);
    if (!session) {
      sendError(response, 404, requestId, "SESSION_NOT_FOUND", "会话不存在。");
      return;
    }

    maybeAdvanceSession(session);
    sendJson(response, 200, buildSessionResponse(session), requestId);
    return;
  }

  if (questionsMatch && method === "GET") {
    const session = ensureSession(questionsMatch[1]);
    if (!session) {
      sendError(response, 404, requestId, "SESSION_NOT_FOUND", "会话不存在。");
      return;
    }

    sendJson(
      response,
      200,
      {
        sessionId: session.sessionId,
        status: session.status,
        questions: fixtures.questions,
      },
      requestId,
    );
    return;
  }

  if (answersMatch && method === "GET") {
    const session = ensureSession(answersMatch[1]);
    if (!session) {
      sendError(response, 404, requestId, "SESSION_NOT_FOUND", "会话不存在。");
      return;
    }

    sendJson(
      response,
      200,
      {
        sessionId: session.sessionId,
        answers: [...session.answers.values()].map((answer) => ({
          questionId: answer.questionId,
          answerId: answer.answerId,
          answerContent: answer.answerContent,
          answerFormat: answer.answerFormat,
          answerVersion: answer.answerVersion,
          savedAt: answer.savedAt,
          finalized: session.status === "submitted" || session.status === "completed",
        })),
      },
      requestId,
    );
    return;
  }

  if (answersMatch && method === "POST") {
    const session = ensureSession(answersMatch[1]);
    if (!session) {
      sendError(response, 404, requestId, "SESSION_NOT_FOUND", "会话不存在。");
      return;
    }

    const payload = await readJsonBody(request);
    if (!payload) {
      sendError(response, 400, requestId, "INVALID_JSON", "请求体不是合法 JSON。");
      return;
    }

    const question = fixtures.questions.find((item) => item.questionId === payload.questionId);
    if (!question) {
      sendError(response, 404, requestId, "QUESTION_NOT_IN_SESSION", "题目不在当前会话中。");
      return;
    }

    if (!payload.idempotencyKey) {
      sendError(response, 400, requestId, "VALIDATION_ERROR", "保存回答必须带 idempotencyKey。");
      return;
    }

    const existingAnswer = session.answers.get(payload.questionId);
    const nextAnswer = {
      questionId: payload.questionId,
      answerId: existingAnswer?.answerId ?? `ans_${crypto.randomBytes(4).toString("hex")}`,
      answerContent: String(payload.answerContent ?? ""),
      answerFormat: payload.answerFormat ?? "plain_text",
      answerVersion: (existingAnswer?.answerVersion ?? 0) + 1,
      savedAt: new Date().toISOString(),
    };

    const responsePayload = {
      sessionId: session.sessionId,
      status: session.status,
      answerId: nextAnswer.answerId,
      answerVersion: nextAnswer.answerVersion,
      savedAt: nextAnswer.savedAt,
    };

    const idempotency = assertIdempotency({
      sessionId: session.sessionId,
      routeKey: "answers",
      actorKey: "candidate-demo",
      idempotencyKey: payload.idempotencyKey,
      payload,
      responsePayload,
    });

    if (!idempotency.ok) {
      sendError(response, 409, requestId, "IDEMPOTENCY_KEY_REUSED", "相同 idempotencyKey 对应的 payload 不一致。");
      return;
    }

    if (idempotency.replay) {
      sendJson(response, 200, { ...idempotency.responsePayload, idempotentReplay: true }, requestId);
      return;
    }

    session.answers.set(payload.questionId, nextAnswer);
    sendJson(response, 200, responsePayload, requestId);
    return;
  }

  if (finalizeMatch && method === "POST") {
    const session = ensureSession(finalizeMatch[1]);
    if (!session) {
      sendError(response, 404, requestId, "SESSION_NOT_FOUND", "会话不存在。");
      return;
    }

    const payload = await readJsonBody(request);
    if (!payload) {
      sendError(response, 400, requestId, "INVALID_JSON", "请求体不是合法 JSON。");
      return;
    }

    if (!payload.idempotencyKey) {
      sendError(response, 400, requestId, "VALIDATION_ERROR", "提交必须带 idempotencyKey。");
      return;
    }

    if (!["in_progress", "submitted", "completed"].includes(session.status)) {
      sendError(response, 409, requestId, "SESSION_STATE_CONFLICT", "当前状态不允许提交。");
      return;
    }

    const finalizedAt = payload.finalizedAt ?? new Date().toISOString();
    const progress = buildProgress(session);
    const responsePayload = {
      sessionId: session.sessionId,
      status: "submitted",
      submittedAt: finalizedAt,
      answeredCount: progress.answeredCount,
      totalCount: progress.totalCount,
      resultAvailable: false,
    };

    const idempotency = assertIdempotency({
      sessionId: session.sessionId,
      routeKey: "finalize",
      actorKey: "candidate-demo",
      idempotencyKey: payload.idempotencyKey,
      payload,
      responsePayload,
    });

    if (!idempotency.ok) {
      sendError(response, 409, requestId, "IDEMPOTENCY_KEY_REUSED", "相同 idempotencyKey 对应的 payload 不一致。");
      return;
    }

    if (idempotency.replay) {
      sendJson(response, 200, { ...idempotency.responsePayload, idempotentReplay: true }, requestId);
      return;
    }

    session.status = "submitted";
    session.submittedAt = finalizedAt;
    sendJson(response, 200, responsePayload, requestId);
    return;
  }

  if (summaryMatch && method === "GET") {
    const session = ensureSession(summaryMatch[1]);
    if (!session) {
      sendError(response, 404, requestId, "SESSION_NOT_FOUND", "会话不存在。");
      return;
    }

    if (!["submitted", "completed"].includes(session.status)) {
      sendError(response, 409, requestId, "SESSION_STATE_CONFLICT", "当前状态尚不能查看结果摘要。");
      return;
    }

    if (session.status === "submitted") {
      session.status = "completed";
      session.completedAt = new Date().toISOString();
    }

    sendJson(
      response,
      200,
      {
        sessionId: session.sessionId,
        status: session.status,
        summary: fixtures.resultSummary.summary,
        dimensionScores: fixtures.resultSummary.dimensionScores,
        hireRecommendation: fixtures.resultSummary.hireRecommendation,
        riskTags: fixtures.resultSummary.riskTags,
        findings: fixtures.resultSummary.findings,
        timeline: buildTimeline(session),
      },
      requestId,
    );
    return;
  }

  sendError(response, 404, requestId, "ROUTE_NOT_FOUND", "未找到对应接口。");
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  try {
    if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") {
      await handleApi(request, response, url);
      return;
    }

    const served = await serveStaticFile(url.pathname, response);
    if (!served) {
      response.writeHead(404, {
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("Not found");
    }
  } catch (error) {
    const requestId = createRequestId();
    sendError(
      response,
      500,
      requestId,
      "INTERNAL_SERVER_ERROR",
      error instanceof Error ? error.message : "未知错误",
    );
  }
});

const port = Number(process.env.PORT ?? 3001);
server.listen(port, "127.0.0.1", () => {
  console.log(`AI Infra Node fallback 已启动: http://127.0.0.1:${port}`);
});
