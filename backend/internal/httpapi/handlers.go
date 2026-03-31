package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

func (s *Server) handleNoRoute(w http.ResponseWriter, r *http.Request) {
	writeError(w, r, http.StatusNotFound, "ROUTE_NOT_FOUND", "未找到对应接口。")
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, r, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDLQReplayContract(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	dlqCount := len(s.dlqRecords)
	s.mu.Unlock()

	writeJSON(w, r, http.StatusOK, map[string]any{
		"schemaVersion":          s.eventSchemaVersion,
		"replayIdempotencyKey":   "<eventType>:<sessionId>:<eventId>",
		"constraints":            dlqReplayConstraints(),
		"deadLetterBacklogCount": dlqCount,
		"traceCarryFields":       []string{"requestId", "traceId", "eventId"},
		"eventEnvelopeRequiredKeys": []string{
			"eventId",
			"eventType",
			"schemaVersion",
			"occurredAt",
			"requestId",
			"traceId",
			"sessionId",
			"payload",
		},
	})
}

func (s *Server) handleSessionCollection(w http.ResponseWriter, r *http.Request) {
	var payload createSessionPayload
	if err := decodeJSONBody(r, &payload); err != nil {
		if errors.Is(err, errInvalidJSON) {
			writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "请求体不是合法 JSON。")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "读取请求体失败。")
		return
	}

	if strings.TrimSpace(payload.CandidateID) == "" ||
		strings.TrimSpace(payload.InterviewPlanID) == "" ||
		strings.TrimSpace(payload.Mode) == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "缺少 candidateId、interviewPlanId 或 mode。")
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)
	s.mu.Lock()
	sessionID := s.nextSessionID()
	session := &sessionRecord{
		SessionID:       sessionID,
		CandidateID:     payload.CandidateID,
		InterviewPlanID: payload.InterviewPlanID,
		Mode:            payload.Mode,
		EntryToken:      payload.EntryToken,
		Status:          "pending",
		CreatedAt:       now,
		Answers:         make(map[string]*answerRecord),
	}
	s.sessions[sessionID] = session
	response := s.buildSessionResponse(session)
	s.mu.Unlock()

	envelope := s.publishEvent(r, "interview.session.created", sessionID, map[string]any{
		"candidateId":     payload.CandidateID,
		"interviewPlanId": payload.InterviewPlanID,
		"mode":            payload.Mode,
		"status":          "pending",
	}, "")
	response["eventId"] = envelope.EventID

	writeJSON(w, r, http.StatusCreated, response)
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request, sessionID string) {
	if sessionID == "" {
		writeError(w, r, http.StatusNotFound, "ROUTE_NOT_FOUND", "未找到对应接口。")
		return
	}

	s.mu.Lock()
	session := s.getSession(sessionID)
	if session == nil {
		s.mu.Unlock()
		writeError(w, r, http.StatusNotFound, "SESSION_NOT_FOUND", "会话不存在。")
		return
	}

	if session.Status == "pending" {
		session.PollCount++
		if session.PollCount >= 1 {
			now := time.Now().UTC().Format(time.RFC3339)
			session.Status = "preparing"
			session.PreparingAt = &now
		}
	} else if session.Status == "preparing" {
		session.PollCount++
		if session.PollCount >= 2 {
			now := time.Now().UTC().Format(time.RFC3339)
			session.Status = "in_progress"
			session.StartedAt = &now
		}
	}

	response := s.buildSessionResponse(session)
	s.mu.Unlock()
	writeJSON(w, r, http.StatusOK, response)
}

func (s *Server) handleGetQuestions(w http.ResponseWriter, r *http.Request, sessionID string) {
	if sessionID == "" {
		writeError(w, r, http.StatusNotFound, "ROUTE_NOT_FOUND", "未找到对应接口。")
		return
	}

	s.mu.Lock()
	session := s.getSession(sessionID)
	if session == nil {
		s.mu.Unlock()
		writeError(w, r, http.StatusNotFound, "SESSION_NOT_FOUND", "会话不存在。")
		return
	}
	response := map[string]any{
		"sessionId": session.SessionID,
		"status":    session.Status,
		"questions": s.fixtures.Questions,
	}
	s.mu.Unlock()
	writeJSON(w, r, http.StatusOK, response)
}

func (s *Server) handleGetAnswers(w http.ResponseWriter, r *http.Request, sessionID string) {
	if sessionID == "" {
		writeError(w, r, http.StatusNotFound, "ROUTE_NOT_FOUND", "未找到对应接口。")
		return
	}

	s.mu.Lock()
	session := s.getSession(sessionID)
	if session == nil {
		s.mu.Unlock()
		writeError(w, r, http.StatusNotFound, "SESSION_NOT_FOUND", "会话不存在。")
		return
	}

	finalized := session.Status == "submitted" || session.Status == "completed"
	answers := make([]map[string]any, 0, len(session.Answers))
	for _, questionItem := range s.fixtures.Questions {
		answer, ok := session.Answers[questionItem.QuestionID]
		if !ok {
			continue
		}
		answers = append(answers, map[string]any{
			"questionId":    answer.QuestionID,
			"answerId":      answer.AnswerID,
			"answerContent": answer.AnswerContent,
			"answerFormat":  answer.AnswerFormat,
			"answerVersion": answer.AnswerVersion,
			"savedAt":       answer.SavedAt,
			"finalized":     finalized,
		})
	}

	response := map[string]any{
		"sessionId": session.SessionID,
		"answers":   answers,
	}
	s.mu.Unlock()
	writeJSON(w, r, http.StatusOK, response)
}

func (s *Server) handleSaveAnswer(w http.ResponseWriter, r *http.Request, sessionID string) {
	if sessionID == "" {
		writeError(w, r, http.StatusNotFound, "ROUTE_NOT_FOUND", "未找到对应接口。")
		return
	}

	var payload saveAnswerPayload
	if err := decodeJSONBody(r, &payload); err != nil {
		if errors.Is(err, errInvalidJSON) {
			writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "请求体不是合法 JSON。")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "读取请求体失败。")
		return
	}

	s.mu.Lock()
	session := s.getSession(sessionID)
	if session == nil {
		s.mu.Unlock()
		writeError(w, r, http.StatusNotFound, "SESSION_NOT_FOUND", "会话不存在。")
		return
	}

	if !s.questionExists(payload.QuestionID) {
		s.mu.Unlock()
		writeError(w, r, http.StatusNotFound, "QUESTION_NOT_IN_SESSION", "题目不在当前会话中。")
		return
	}

	if strings.TrimSpace(payload.IdempotencyKey) == "" {
		s.mu.Unlock()
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "保存回答必须带 idempotencyKey。")
		return
	}

	existing := session.Answers[payload.QuestionID]
	answerID := fmt.Sprintf("ans_%s", randomHex(4))
	answerVersion := 1
	if existing != nil {
		answerID = existing.AnswerID
		answerVersion = existing.AnswerVersion + 1
	}
	eventID := deriveEventID(session.SessionID, "answers", "candidate-demo", payload.IdempotencyKey)
	savedAt := time.Now().UTC().Format(time.RFC3339)
	responsePayload := map[string]any{
		"sessionId":     session.SessionID,
		"status":        session.Status,
		"answerId":      answerID,
		"answerVersion": answerVersion,
		"savedAt":       savedAt,
		"eventId":       eventID,
	}

	idempotency, idempotencyResponse := s.assertIdempotency(
		session.SessionID,
		"answers",
		"candidate-demo",
		payload.IdempotencyKey,
		payload,
		responsePayload,
	)
	if !idempotency {
		s.mu.Unlock()
		writeError(w, r, http.StatusConflict, "IDEMPOTENCY_KEY_REUSED", "相同 idempotencyKey 对应的 payload 不一致。")
		return
	}

	if idempotencyResponse != nil {
		idempotencyResponse["idempotentReplay"] = true
		s.mu.Unlock()
		writeJSON(w, r, http.StatusOK, idempotencyResponse)
		return
	}

	session.Answers[payload.QuestionID] = &answerRecord{
		QuestionID:    payload.QuestionID,
		AnswerID:      answerID,
		AnswerContent: payload.AnswerContent,
		AnswerFormat:  firstNonEmpty(payload.AnswerFormat, "plain_text"),
		AnswerVersion: answerVersion,
		SavedAt:       savedAt,
	}
	s.mu.Unlock()
	s.publishEvent(r, "interview.answer.saved", sessionID, map[string]any{
		"questionId":    payload.QuestionID,
		"answerId":      answerID,
		"answerVersion": answerVersion,
		"savedAt":       savedAt,
	}, eventID)
	writeJSON(w, r, http.StatusOK, responsePayload)
}

func (s *Server) handleFinalize(w http.ResponseWriter, r *http.Request, sessionID string) {
	if sessionID == "" {
		writeError(w, r, http.StatusNotFound, "ROUTE_NOT_FOUND", "未找到对应接口。")
		return
	}

	var payload finalizePayload
	if err := decodeJSONBody(r, &payload); err != nil {
		if errors.Is(err, errInvalidJSON) {
			writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "请求体不是合法 JSON。")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "读取请求体失败。")
		return
	}

	if strings.TrimSpace(payload.IdempotencyKey) == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "提交必须带 idempotencyKey。")
		return
	}

	s.mu.Lock()
	session := s.getSession(sessionID)
	if session == nil {
		s.mu.Unlock()
		writeError(w, r, http.StatusNotFound, "SESSION_NOT_FOUND", "会话不存在。")
		return
	}

	if session.Status != "in_progress" && session.Status != "submitted" && session.Status != "completed" {
		s.mu.Unlock()
		writeError(w, r, http.StatusConflict, "SESSION_STATE_CONFLICT", "当前状态不允许提交。")
		return
	}

	finalizedAt := strings.TrimSpace(payload.FinalizedAt)
	if finalizedAt == "" {
		finalizedAt = time.Now().UTC().Format(time.RFC3339)
	}
	answeredCount, totalCount := s.buildProgress(session)
	eventID := deriveEventID(session.SessionID, "finalize", "candidate-demo", payload.IdempotencyKey)

	responsePayload := map[string]any{
		"sessionId":       session.SessionID,
		"status":          "submitted",
		"submittedAt":     finalizedAt,
		"answeredCount":   answeredCount,
		"totalCount":      totalCount,
		"resultAvailable": false,
		"eventId":         eventID,
	}

	idempotency, idempotencyResponse := s.assertIdempotency(
		session.SessionID,
		"finalize",
		"candidate-demo",
		payload.IdempotencyKey,
		payload,
		responsePayload,
	)
	if !idempotency {
		s.mu.Unlock()
		writeError(w, r, http.StatusConflict, "IDEMPOTENCY_KEY_REUSED", "相同 idempotencyKey 对应的 payload 不一致。")
		return
	}
	if idempotencyResponse != nil {
		idempotencyResponse["idempotentReplay"] = true
		s.mu.Unlock()
		writeJSON(w, r, http.StatusOK, idempotencyResponse)
		return
	}

	session.Status = "submitted"
	session.SubmittedAt = &finalizedAt
	s.mu.Unlock()
	s.publishEvent(r, "interview.session.finalized", sessionID, map[string]any{
		"status":        "submitted",
		"submittedAt":   finalizedAt,
		"answeredCount": answeredCount,
		"totalCount":    totalCount,
	}, eventID)
	writeJSON(w, r, http.StatusOK, responsePayload)
}

func (s *Server) handleResultSummary(w http.ResponseWriter, r *http.Request, sessionID string) {
	if sessionID == "" {
		writeError(w, r, http.StatusNotFound, "ROUTE_NOT_FOUND", "未找到对应接口。")
		return
	}

	s.mu.Lock()
	session := s.getSession(sessionID)
	if session == nil {
		s.mu.Unlock()
		writeError(w, r, http.StatusNotFound, "SESSION_NOT_FOUND", "会话不存在。")
		return
	}

	if session.Status != "submitted" && session.Status != "completed" {
		s.mu.Unlock()
		writeError(w, r, http.StatusConflict, "SESSION_STATE_CONFLICT", "当前状态尚不能查看结果摘要。")
		return
	}

	if session.Status != "completed" {
		s.mu.Unlock()
		writeError(w, r, http.StatusConflict, "SESSION_STATE_CONFLICT", "当前状态尚未完成面评，结果摘要不可读。")
		return
	}

	responsePayload := map[string]any{
		"sessionId":          session.SessionID,
		"status":             session.Status,
		"summary":            s.fixtures.ResultSummary.Summary,
		"dimensionScores":    s.fixtures.ResultSummary.DimensionScores,
		"hireRecommendation": s.fixtures.ResultSummary.HireRecommendation,
		"riskTags":           s.fixtures.ResultSummary.RiskTags,
		"findings":           s.fixtures.ResultSummary.Findings,
		"timeline":           s.buildTimeline(session),
	}
	s.mu.Unlock()
	writeJSON(w, r, http.StatusOK, responsePayload)
}

func (s *Server) handleSubmitEvaluation(w http.ResponseWriter, r *http.Request, sessionID string) {
	if sessionID == "" {
		writeError(w, r, http.StatusNotFound, "ROUTE_NOT_FOUND", "未找到对应接口。")
		return
	}

	var payload submitEvaluationPayload
	if err := decodeJSONBody(r, &payload); err != nil {
		if errors.Is(err, errInvalidJSON) {
			writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "请求体不是合法 JSON。")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "读取请求体失败。")
		return
	}

	if strings.TrimSpace(payload.IdempotencyKey) == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "提交面评必须带 idempotencyKey。")
		return
	}

	s.mu.Lock()
	session := s.getSession(sessionID)
	if session == nil {
		s.mu.Unlock()
		writeError(w, r, http.StatusNotFound, "SESSION_NOT_FOUND", "会话不存在。")
		return
	}

	if session.Status != "submitted" && session.Status != "completed" {
		s.mu.Unlock()
		writeError(w, r, http.StatusConflict, "SESSION_STATE_CONFLICT", "当前状态不允许提交面评。")
		return
	}

	completedAt := time.Now().UTC().Format(time.RFC3339)
	eventID := deriveEventID(session.SessionID, "evaluations", "interviewer-demo", payload.IdempotencyKey)
	responsePayload := map[string]any{
		"evaluationId": fmt.Sprintf("eval_%s", session.SessionID),
		"sessionId":    session.SessionID,
		"status":       "completed",
		"completedAt":  completedAt,
		"eventId":      eventID,
	}

	idempotency, idempotencyResponse := s.assertIdempotency(
		session.SessionID,
		"evaluations",
		"interviewer-demo",
		payload.IdempotencyKey,
		payload,
		responsePayload,
	)
	if !idempotency {
		s.mu.Unlock()
		writeError(w, r, http.StatusConflict, "IDEMPOTENCY_KEY_REUSED", "相同 idempotencyKey 对应的 payload 不一致。")
		return
	}
	if idempotencyResponse != nil {
		idempotencyResponse["idempotentReplay"] = true
		s.mu.Unlock()
		writeJSON(w, r, http.StatusOK, idempotencyResponse)
		return
	}

	session.Status = "completed"
	session.CompletedAt = &completedAt
	s.mu.Unlock()
	s.publishEvent(r, "interview.evaluation.submitted", sessionID, map[string]any{
		"evaluationId": fmt.Sprintf("eval_%s", sessionID),
		"status":       "completed",
		"completedAt":  completedAt,
	}, eventID)
	writeJSON(w, r, http.StatusOK, responsePayload)
}
