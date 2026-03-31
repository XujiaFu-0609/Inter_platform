import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const captureDir = process.env.CAPTURE_DIR ? path.resolve(process.env.CAPTURE_DIR) : null;

async function request(step, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const body = await response.json();
  const traceIdHeader = response.headers.get("x-trace-id");
  const eventIdHeader = response.headers.get("x-event-id");
  const payload = {
    step,
    method: options.method ?? "GET",
    url: `${baseUrl}${pathname}`,
    statusCode: response.status,
    requestId: body.requestId ?? null,
    traceId: body.traceId ?? null,
    eventId: body.eventId ?? null,
    traceIdHeader,
    eventIdHeader,
    body,
  };

  if (captureDir) {
    await writeFile(
      path.join(captureDir, `${String(step).padStart(2, "0")}-${pathname.replaceAll(/[/:{}]/g, "_") || "root"}.json`),
      JSON.stringify(payload, null, 2),
    );
  }

  if (!response.ok) {
    throw new Error(`${step} failed: ${JSON.stringify(payload, null, 2)}`);
  }

  return body;
}

async function main() {
  if (captureDir) {
    await mkdir(captureDir, { recursive: true });
    const existingFiles = await readdir(captureDir);
    await Promise.all(
      existingFiles
        .filter((fileName) => fileName.endsWith(".json"))
        .map((fileName) => rm(path.join(captureDir, fileName))),
    );
  }

  const created = await request(1, "/api/v1/interview-sessions", {
    method: "POST",
    body: JSON.stringify({
      candidateId: "cand_demo_001",
      interviewPlanId: "plan_aiinfra_mvp_001",
      mode: "live_interview",
      entryToken: "smoke_entry_token",
    }),
  });

  const sessionId = created.sessionId;
  let session = created;

  session = await request(2, `/api/v1/interview-sessions/${sessionId}`);
  session = await request(3, `/api/v1/interview-sessions/${sessionId}`);
  if (session.status !== "in_progress") {
    throw new Error(`session did not enter in_progress: ${session.status}`);
  }

  const questions = await request(4, `/api/v1/interview-sessions/${sessionId}/questions`);
  const firstQuestion = questions.questions[0];

  await request(5, `/api/v1/interview-sessions/${sessionId}/answers`, {
    method: "POST",
    body: JSON.stringify({
      questionId: firstQuestion.questionId,
      answerContent:
        "候选人说明了网关、会话编排、题库与面评服务边界，并补充 requestId 贯穿日志检索链路。",
      answerFormat: "plain_text",
      clientSavedAt: new Date().toISOString(),
      idempotencyKey: `smoke-answer-${sessionId}`,
    }),
  });

  await request(6, `/api/v1/interview-sessions/${sessionId}/finalize`, {
    method: "POST",
    body: JSON.stringify({
      finalizedAt: new Date().toISOString(),
      idempotencyKey: `smoke-finalize-${sessionId}`,
    }),
  });

  await request(7, `/api/v1/interview-sessions/${sessionId}/evaluations`, {
    method: "POST",
    body: JSON.stringify({
      scores: [
        { dimension: "system_design", score: 4 },
        { dimension: "kubernetes", score: 5 },
        { dimension: "data_analysis", score: 4 },
      ],
      summary: "smoke review",
      hireRecommendation: "advance",
      riskTags: ["mock-seed"],
      idempotencyKey: `smoke-evaluation-${sessionId}`,
    }),
  });

  const summary = await request(8, `/api/v1/interview-sessions/${sessionId}/result-summary`);
  console.log(JSON.stringify({ ok: true, sessionId, requestId: summary.requestId, traceId: summary.traceId }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
