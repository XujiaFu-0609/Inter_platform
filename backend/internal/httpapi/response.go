package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var errInvalidJSON = errors.New("invalid_json")

type contextKey string

const (
	requestMetaKey       contextKey = "request_meta"
	eventSchemaVersionV1            = "v1alpha1"
)

type requestMeta struct {
	RequestID string
	TraceID   string
}

type responseRecorder struct {
	http.ResponseWriter
	statusCode int
}

func (r *responseRecorder) WriteHeader(statusCode int) {
	r.statusCode = statusCode
	r.ResponseWriter.WriteHeader(statusCode)
}

func incomingTraceID(r *http.Request) string {
	if traceID := strings.TrimSpace(r.Header.Get("x-trace-id")); traceID != "" {
		return traceID
	}
	return makeTraceID()
}

func makeRequestID() string {
	return fmt.Sprintf("req_%d_%s", time.Now().UnixMilli(), randomHex(3))
}

func makeTraceID() string {
	return fmt.Sprintf("trace_%d_%s", time.Now().UnixMilli(), randomHex(4))
}

func makeEventID() string {
	return fmt.Sprintf("evt_%d_%s", time.Now().UnixMilli(), randomHex(4))
}

func randomHex(size int) string {
	raw := make([]byte, size)
	if _, err := rand.Read(raw); err != nil {
		return "fallback"
	}
	return hex.EncodeToString(raw)
}

func currentMeta(r *http.Request) requestMeta {
	value := r.Context().Value(requestMetaKey)
	meta, ok := value.(requestMeta)
	if !ok {
		return requestMeta{
			RequestID: makeRequestID(),
			TraceID:   makeTraceID(),
		}
	}
	return meta
}

func withRequestMeta(r *http.Request) *http.Request {
	meta := requestMeta{
		RequestID: makeRequestID(),
		TraceID:   incomingTraceID(r),
	}
	return r.WithContext(context.WithValue(r.Context(), requestMetaKey, meta))
}

func writeJSON(w http.ResponseWriter, r *http.Request, statusCode int, payload map[string]any) {
	meta := currentMeta(r)
	resp := map[string]any{
		"requestId": meta.RequestID,
		"traceId":   meta.TraceID,
	}
	for key, value := range payload {
		resp[key] = value
	}

	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.Header().Set("x-request-id", meta.RequestID)
	w.Header().Set("x-trace-id", meta.TraceID)
	if eventID, ok := resp["eventId"].(string); ok && strings.TrimSpace(eventID) != "" {
		w.Header().Set("x-event-id", eventID)
	}
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(resp)
}

func writeError(w http.ResponseWriter, r *http.Request, statusCode int, errorCode, message string) {
	writeJSON(w, r, statusCode, map[string]any{
		"errorCode": errorCode,
		"message":   message,
	})
}

func decodeJSONBody(r *http.Request, target any) error {
	rawBody, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return err
	}
	body := strings.TrimSpace(string(rawBody))
	if body == "" {
		body = "{}"
	}
	if err := json.Unmarshal([]byte(body), target); err != nil {
		return errInvalidJSON
	}
	return nil
}
