package httpapi

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func (s *Server) nextSessionID() string {
	sessionID := fmt.Sprintf("sess_demo_%s_%03d", time.Now().Format("20060102"), s.counter)
	s.counter++
	return sessionID
}

func (s *Server) getSession(sessionID string) *sessionRecord {
	session, ok := s.sessions[sessionID]
	if !ok {
		return nil
	}
	return session
}

func (s *Server) buildSessionResponse(session *sessionRecord) map[string]any {
	progressAnswered, progressTotal := s.buildProgress(session)
	return map[string]any{
		"sessionId":                 session.SessionID,
		"candidateId":               session.CandidateID,
		"interviewPlanId":           session.InterviewPlanID,
		"mode":                      session.Mode,
		"status":                    session.Status,
		"timeline":                  s.buildTimeline(session),
		"progress":                  map[string]any{"answeredCount": progressAnswered, "totalCount": progressTotal},
		"remainingResumeCount":      1,
		"resumeDeadlineAt":          nil,
		"resultAvailable":           session.Status == "completed",
		"questionSetPolicyResolved": s.fixtures.InterviewPlan.QuestionSetPolicyResolved,
		"candidate":                 s.fixtures.Candidate,
		"interviewPlan":             s.fixtures.InterviewPlan,
	}
}

func (s *Server) buildTimeline(session *sessionRecord) map[string]any {
	return map[string]any{
		"createdAt":   session.CreatedAt,
		"preparingAt": session.PreparingAt,
		"startedAt":   session.StartedAt,
		"submittedAt": session.SubmittedAt,
		"completedAt": session.CompletedAt,
	}
}

func (s *Server) buildProgress(session *sessionRecord) (int, int) {
	answeredCount := 0
	for _, answer := range session.Answers {
		if strings.TrimSpace(answer.AnswerContent) != "" {
			answeredCount++
		}
	}
	return answeredCount, len(s.fixtures.Questions)
}

func firstNonEmpty(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}

func (s *Server) questionExists(questionID string) bool {
	for _, item := range s.fixtures.Questions {
		if item.QuestionID == questionID {
			return true
		}
	}
	return false
}

func (s *Server) assertIdempotency(
	sessionID string,
	routeKey string,
	actorKey string,
	idempotencyKey string,
	payload any,
	response map[string]any,
) (bool, map[string]any) {
	encodedPayload, _ := json.Marshal(payload)
	payloadHash := sha1.Sum(encodedPayload)
	recordKey := fmt.Sprintf("%s:%s:%s:%s", sessionID, routeKey, actorKey, idempotencyKey)
	existing, exists := s.idempotent[recordKey]
	if !exists {
		s.idempotent[recordKey] = idempotencyRecord{
			PayloadHash: hex.EncodeToString(payloadHash[:]),
			Response:    cloneMap(response),
		}
		return true, nil
	}

	currentHash := hex.EncodeToString(payloadHash[:])
	if existing.PayloadHash != currentHash {
		return false, nil
	}
	return true, cloneMap(existing.Response)
}

func cloneMap(src map[string]any) map[string]any {
	dst := make(map[string]any, len(src))
	for key, value := range src {
		dst[key] = value
	}
	return dst
}
