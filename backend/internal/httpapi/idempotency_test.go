package httpapi

import (
	"net/http"
	"testing"
)

func TestSaveAnswerIdempotencyReplayAndConflict(t *testing.T) {
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

	first := performJSONRequest(t, server, http.MethodPost, "/api/v1/interview-sessions/"+sessionID+"/answers", map[string]any{
		"questionId":     "q_001",
		"answerContent":  "same-content",
		"answerFormat":   "plain_text",
		"clientSavedAt":  "2026-03-27T00:00:00Z",
		"idempotencyKey": "idem-key-001",
	})
	if first["idempotentReplay"] != nil {
		t.Fatalf("first request should not be replay: %#v", first)
	}

	replay := performJSONRequest(t, server, http.MethodPost, "/api/v1/interview-sessions/"+sessionID+"/answers", map[string]any{
		"questionId":     "q_001",
		"answerContent":  "same-content",
		"answerFormat":   "plain_text",
		"clientSavedAt":  "2026-03-27T00:00:00Z",
		"idempotencyKey": "idem-key-001",
	})
	if replay["idempotentReplay"] != true {
		t.Fatalf("expected idempotentReplay=true, got %#v", replay)
	}

	conflictRecorder := performRequest(t, server, http.MethodPost, "/api/v1/interview-sessions/"+sessionID+"/answers", map[string]any{
		"questionId":     "q_001",
		"answerContent":  "changed-content",
		"answerFormat":   "plain_text",
		"clientSavedAt":  "2026-03-27T00:00:00Z",
		"idempotencyKey": "idem-key-001",
	})
	if conflictRecorder.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", conflictRecorder.Code, conflictRecorder.Body.String())
	}
}
