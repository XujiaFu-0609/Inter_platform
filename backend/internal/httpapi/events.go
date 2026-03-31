package httpapi

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

func deriveEventID(sessionID, routeKey, actorKey, idempotencyKey string) string {
	base := fmt.Sprintf("%s:%s:%s:%s", sessionID, routeKey, actorKey, idempotencyKey)
	hash := sha1.Sum([]byte(base))
	return fmt.Sprintf("evt_%s", hex.EncodeToString(hash[:8]))
}

func (s *Server) publishEvent(r *http.Request, eventType, sessionID string, payload map[string]any, fixedEventID string) eventEnvelope {
	meta := currentMeta(r)
	eventID := strings.TrimSpace(fixedEventID)
	if eventID == "" {
		eventID = makeEventID()
	}
	envelope := eventEnvelope{
		EventID:       eventID,
		EventType:     eventType,
		SchemaVersion: s.eventSchemaVersion,
		OccurredAt:    time.Now().UTC().Format(time.RFC3339),
		RequestID:     meta.RequestID,
		TraceID:       meta.TraceID,
		SessionID:     sessionID,
		Payload:       cloneMap(payload),
	}
	s.logger.Printf(
		"event_publish eventId=%s eventType=%s requestId=%s traceId=%s sessionId=%s",
		envelope.EventID,
		envelope.EventType,
		envelope.RequestID,
		envelope.TraceID,
		envelope.SessionID,
	)

	select {
	case s.eventQueue <- envelope:
	default:
		s.routeToDLQ(envelope, "event_queue_full")
	}

	return envelope
}

func (s *Server) consumeEvents() {
	for envelope := range s.eventQueue {
		s.logger.Printf(
			"event_consume eventId=%s eventType=%s requestId=%s traceId=%s sessionId=%s",
			envelope.EventID,
			envelope.EventType,
			envelope.RequestID,
			envelope.TraceID,
			envelope.SessionID,
		)
	}
}

func (s *Server) routeToDLQ(envelope eventEnvelope, reason string) {
	encodedPayload, _ := json.Marshal(envelope.Payload)
	payloadHash := sha1.Sum(encodedPayload)
	replayKey := buildDLQReplayKey(envelope)
	record := deadLetterRecord{
		Envelope:          envelope,
		Reason:            reason,
		ReplayKey:         replayKey,
		PayloadHash:       hex.EncodeToString(payloadHash[:]),
		FirstFailedAt:     time.Now().UTC().Format(time.RFC3339),
		ReplayConstraints: dlqReplayConstraints(),
	}
	s.mu.Lock()
	s.dlqRecords = append(s.dlqRecords, record)
	s.mu.Unlock()

	s.logger.Printf(
		"event_dlq eventId=%s eventType=%s requestId=%s traceId=%s sessionId=%s replayKey=%s reason=%s",
		envelope.EventID,
		envelope.EventType,
		envelope.RequestID,
		envelope.TraceID,
		envelope.SessionID,
		replayKey,
		reason,
	)
}

func buildDLQReplayKey(envelope eventEnvelope) string {
	return fmt.Sprintf("%s:%s:%s", envelope.EventType, envelope.SessionID, envelope.EventID)
}

func dlqReplayConstraints() []string {
	return []string{
		"同一 replay key 仅允许一次成功回放，重复请求必须返回幂等成功。",
		"回放输入必须保持 eventType/sessionId/eventId/payloadHash 一致，不允许覆盖已落库副作用。",
		"回放过程沿用原 requestId/traceId/eventId，确保 HTTP 与异步链路可追溯。",
	}
}
