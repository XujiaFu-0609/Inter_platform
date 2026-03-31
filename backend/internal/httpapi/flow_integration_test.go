package httpapi

import (
	"net/http"
	"testing"
)

func TestFullSessionFlowIntegration(t *testing.T) {
	server := newTestServer(t)

	created := performJSONRequest(t, server, http.MethodPost, "/api/v1/interview-sessions", map[string]any{
		"candidateId":     "cand_demo_001",
		"interviewPlanId": "plan_aiinfra_mvp_001",
		"mode":            "live_interview",
		"entryToken":      "entry-token",
	})
	sessionID := created["sessionId"].(string)

	session1 := performJSONRequest(t, server, http.MethodGet, "/api/v1/interview-sessions/"+sessionID, nil)
	if got := session1["status"]; got != "preparing" {
		t.Fatalf("expected preparing, got %v", got)
	}
	session2 := performJSONRequest(t, server, http.MethodGet, "/api/v1/interview-sessions/"+sessionID, nil)
	if got := session2["status"]; got != "in_progress" {
		t.Fatalf("expected in_progress, got %v", got)
	}

	performJSONRequest(t, server, http.MethodPost, "/api/v1/interview-sessions/"+sessionID+"/answers", map[string]any{
		"questionId":     "q_001",
		"answerContent":  "integration-answer",
		"answerFormat":   "plain_text",
		"clientSavedAt":  "2026-03-27T00:00:00Z",
		"idempotencyKey": "integration-answer-key",
	})

	finalized := performJSONRequest(t, server, http.MethodPost, "/api/v1/interview-sessions/"+sessionID+"/finalize", map[string]any{
		"finalizedAt":    "2026-03-27T00:00:01Z",
		"idempotencyKey": "integration-finalize-key",
	})
	if got := finalized["status"]; got != "submitted" {
		t.Fatalf("expected submitted, got %v", got)
	}

	evaluation := performJSONRequest(t, server, http.MethodPost, "/api/v1/interview-sessions/"+sessionID+"/evaluations", map[string]any{
		"scores": []map[string]any{
			{"dimension": "system_design", "score": 4},
		},
		"summary":            "integration-summary",
		"hireRecommendation": "advance",
		"riskTags":           []string{"mock"},
		"idempotencyKey":     "integration-evaluation-key",
	})
	if got := evaluation["status"]; got != "completed" {
		t.Fatalf("expected completed, got %v", got)
	}

	summary := performJSONRequest(t, server, http.MethodGet, "/api/v1/interview-sessions/"+sessionID+"/result-summary", nil)
	if got := summary["status"]; got != "completed" {
		t.Fatalf("expected completed summary, got %v", got)
	}
	if summary["requestId"] == "" || summary["traceId"] == "" {
		t.Fatalf("missing tracing fields: %#v", summary)
	}
}
