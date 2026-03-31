package http

import (
	"context"
	"net/http"
)

type SessionService interface {
	CreateSession(ctx context.Context, payload map[string]any) (map[string]any, error)
	GetSession(ctx context.Context, sessionID string) (map[string]any, error)
}

type JSONResponder interface {
	WriteJSON(w http.ResponseWriter, r *http.Request, statusCode int, payload map[string]any)
	WriteError(w http.ResponseWriter, r *http.Request, statusCode int, errorCode, message string)
}
