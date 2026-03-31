package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResultSummaryRequiresCompletedSession(t *testing.T) {
	server := newTestServer(t)

	created := performJSONRequest(t, server, http.MethodPost, "/api/v1/interview-sessions", map[string]any{
		"candidateId":     "cand_demo_001",
		"interviewPlanId": "plan_aiinfra_mvp_001",
		"mode":            "live_interview",
		"entryToken":      "entry-token",
	})
	sessionID := created["sessionId"].(string)

	performJSONRequest(t, server, http.MethodGet, "/api/v1/interview-sessions/"+sessionID, nil)
	performJSONRequest(t, server, http.MethodGet, "/api/v1/interview-sessions/"+sessionID, nil)

	performJSONRequest(t, server, http.MethodPost, "/api/v1/interview-sessions/"+sessionID+"/answers", map[string]any{
		"questionId":     "q_001",
		"answerContent":  "answer",
		"answerFormat":   "plain_text",
		"clientSavedAt":  "2026-03-27T00:00:00Z",
		"idempotencyKey": "answer-1",
	})
	performJSONRequest(t, server, http.MethodPost, "/api/v1/interview-sessions/"+sessionID+"/finalize", map[string]any{
		"finalizedAt":    "2026-03-27T00:00:01Z",
		"idempotencyKey": "finalize-1",
	})

	summaryRecorder := performRequest(t, server, http.MethodGet, "/api/v1/interview-sessions/"+sessionID+"/result-summary", nil)
	if summaryRecorder.Code != http.StatusConflict {
		t.Fatalf("expected 409 before evaluation, got %d: %s", summaryRecorder.Code, summaryRecorder.Body.String())
	}

	var errorBody map[string]any
	decodeResponseBody(t, summaryRecorder.Body.Bytes(), &errorBody)
	if got := errorBody["errorCode"]; got != "SESSION_STATE_CONFLICT" {
		t.Fatalf("expected SESSION_STATE_CONFLICT, got %v", got)
	}

	evaluation := performJSONRequest(t, server, http.MethodPost, "/api/v1/interview-sessions/"+sessionID+"/evaluations", map[string]any{
		"scores": []map[string]any{
			{"dimension": "system_design", "score": 4},
		},
		"summary":            "ready",
		"hireRecommendation": "advance",
		"riskTags":           []string{"mock"},
		"idempotencyKey":     "evaluation-1",
	})
	if got := evaluation["status"]; got != "completed" {
		t.Fatalf("expected completed evaluation status, got %v", got)
	}

	summary := performJSONRequest(t, server, http.MethodGet, "/api/v1/interview-sessions/"+sessionID+"/result-summary", nil)
	if got := summary["status"]; got != "completed" {
		t.Fatalf("expected completed result-summary status, got %v", got)
	}
	if summary["requestId"] == "" || summary["traceId"] == "" {
		t.Fatalf("expected requestId and traceId in summary response: %#v", summary)
	}
}

func TestMutatingEndpointsCarryEventID(t *testing.T) {
	server := newTestServer(t)

	createRecorder := performRequest(t, server, http.MethodPost, "/api/v1/interview-sessions", map[string]any{
		"candidateId":     "cand_demo_001",
		"interviewPlanId": "plan_aiinfra_mvp_001",
		"mode":            "live_interview",
		"entryToken":      "entry-token",
	})
	if createRecorder.Code != http.StatusCreated {
		t.Fatalf("create session failed: %d %s", createRecorder.Code, createRecorder.Body.String())
	}

	var created map[string]any
	decodeResponseBody(t, createRecorder.Body.Bytes(), &created)
	sessionID := created["sessionId"].(string)
	createEventID := created["eventId"].(string)
	if createEventID == "" {
		t.Fatalf("expected eventId in create response body: %#v", created)
	}
	if got := createRecorder.Header().Get("x-event-id"); got != createEventID {
		t.Fatalf("expected x-event-id=%s, got %s", createEventID, got)
	}

	performJSONRequest(t, server, http.MethodGet, "/api/v1/interview-sessions/"+sessionID, nil)
	performJSONRequest(t, server, http.MethodGet, "/api/v1/interview-sessions/"+sessionID, nil)

	saveRecorder := performRequest(t, server, http.MethodPost, "/api/v1/interview-sessions/"+sessionID+"/answers", map[string]any{
		"questionId":     "q_001",
		"answerContent":  "answer",
		"answerFormat":   "plain_text",
		"clientSavedAt":  "2026-03-27T00:00:00Z",
		"idempotencyKey": "answer-event-id",
	})
	if saveRecorder.Code != http.StatusOK {
		t.Fatalf("save answer failed: %d %s", saveRecorder.Code, saveRecorder.Body.String())
	}
	var save map[string]any
	decodeResponseBody(t, saveRecorder.Body.Bytes(), &save)
	saveEventID := save["eventId"].(string)
	if saveEventID == "" {
		t.Fatalf("expected eventId in save-answer response body: %#v", save)
	}
	if got := saveRecorder.Header().Get("x-event-id"); got != saveEventID {
		t.Fatalf("expected x-event-id=%s, got %s", saveEventID, got)
	}
}

func TestDLQReplayContractEndpoint(t *testing.T) {
	server := newTestServer(t)

	recorder := performRequest(t, server, http.MethodGet, "/api/v1/dlq/replay-contract", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var body map[string]any
	decodeResponseBody(t, recorder.Body.Bytes(), &body)

	if got := body["schemaVersion"]; got != "v1alpha1" {
		t.Fatalf("expected schemaVersion=v1alpha1, got %v", got)
	}
	if got := body["replayIdempotencyKey"]; got != "<eventType>:<sessionId>:<eventId>" {
		t.Fatalf("unexpected replay idempotency key template: %v", got)
	}
	constraints, ok := body["constraints"].([]any)
	if !ok || len(constraints) != 3 {
		t.Fatalf("expected 3 replay constraints, got %#v", body["constraints"])
	}
}

func TestServeStaticFrontendWhenConfigured(t *testing.T) {
	server := newTestServer(t)

	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<!doctype html><html><body>frontend-shell</body></html>"), 0o600); err != nil {
		t.Fatalf("write index: %v", err)
	}
	if err := os.WriteFile(filepath.Join(staticDir, "app.js"), []byte("console.log('frontend');"), 0o600); err != nil {
		t.Fatalf("write app.js: %v", err)
	}
	server.staticDir = staticDir

	indexRecorder := performRequest(t, server, http.MethodGet, "/", nil)
	if indexRecorder.Code != http.StatusOK {
		t.Fatalf("expected index 200, got %d: %s", indexRecorder.Code, indexRecorder.Body.String())
	}
	if !strings.Contains(indexRecorder.Body.String(), "frontend-shell") {
		t.Fatalf("expected index shell body, got: %s", indexRecorder.Body.String())
	}

	spaRecorder := performRequest(t, server, http.MethodGet, "/session/sess_demo_20260327_001/launch", nil)
	if spaRecorder.Code != http.StatusOK {
		t.Fatalf("expected spa fallback 200, got %d: %s", spaRecorder.Code, spaRecorder.Body.String())
	}
	if !strings.Contains(spaRecorder.Body.String(), "frontend-shell") {
		t.Fatalf("expected spa fallback index body, got: %s", spaRecorder.Body.String())
	}

	assetRecorder := performRequest(t, server, http.MethodGet, "/app.js", nil)
	if assetRecorder.Code != http.StatusOK {
		t.Fatalf("expected asset 200, got %d: %s", assetRecorder.Code, assetRecorder.Body.String())
	}
	if !strings.Contains(assetRecorder.Body.String(), "frontend") {
		t.Fatalf("expected app.js body, got: %s", assetRecorder.Body.String())
	}

	missingRecorder := performRequest(t, server, http.MethodGet, "/missing.js", nil)
	if missingRecorder.Code != http.StatusNotFound {
		t.Fatalf("expected missing asset 404, got %d", missingRecorder.Code)
	}
}

func newTestServer(t *testing.T) *Server {
	t.Helper()

	fixtureDir := t.TempDir()
	fixturePath := filepath.Join(fixtureDir, "demo-fixtures.json")
	if err := os.WriteFile(fixturePath, []byte(`{
  "candidate": {"candidateId":"cand_demo_001","name":"陈墨","targetRole":"AI Infra 调度工程师"},
  "interviewPlan": {
    "interviewPlanId":"plan_aiinfra_mvp_001",
    "title":"AI Infra 模拟面试（MVP）",
    "mode":"live_interview",
    "interviewerId":"interviewer_demo_001",
    "interviewerName":"张弛",
    "plannedDurationMinutes":45,
    "questionSetPolicyResolved":"fixed"
  },
  "questions": [
    {"questionId":"q_001","sequenceNo":1,"type":"system_design","title":"题目1","stem":"说明架构","constraints":["约束1"]}
  ],
  "resultSummary": {
    "summary":"候选人具备较强的云原生排障与架构拆解能力。",
    "dimensionScores":[{"dimension":"system_design","score":4}],
    "hireRecommendation":"advance",
    "riskTags":["mock"],
    "findings":["good"]
  }
}`), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	server, err := NewServer(Config{FixturePath: fixturePath})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	return server
}

func performJSONRequest(t *testing.T, server *Server, method, path string, payload map[string]any) map[string]any {
	t.Helper()

	recorder := performRequest(t, server, method, path, payload)
	if recorder.Code < 200 || recorder.Code >= 300 {
		t.Fatalf("expected success, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var response map[string]any
	decodeResponseBody(t, recorder.Body.Bytes(), &response)
	return response
}

func performRequest(t *testing.T, server *Server, method, path string, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()

	var body io.Reader = http.NoBody
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal payload: %v", err)
		}
		body = bytes.NewReader(encoded)
	}

	request := httptest.NewRequest(method, path, body)
	if payload != nil {
		request.Header.Set("content-type", "application/json")
	}

	recorder := httptest.NewRecorder()
	server.httpServer.Handler.ServeHTTP(recorder, request)
	return recorder
}

func decodeResponseBody(t *testing.T, body []byte, target any) {
	t.Helper()
	if err := json.Unmarshal(body, target); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}
