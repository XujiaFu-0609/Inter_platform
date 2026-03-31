package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func NewServer(cfg Config) (*Server, error) {
	if cfg.Logger == nil {
		cfg.Logger = log.New(os.Stdout, "", log.LstdFlags|log.LUTC)
	}
	if cfg.Addr == "" {
		cfg.Addr = "127.0.0.1:3000"
	}
	if cfg.FixturePath == "" {
		cfg.FixturePath = "data/demo-fixtures.json"
	}

	fixturesData, err := loadFixtures(cfg.FixturePath)
	if err != nil {
		return nil, err
	}

	server := &Server{
		addr:               cfg.Addr,
		staticDir:          strings.TrimSpace(cfg.StaticDir),
		fixtures:           fixturesData,
		logger:             cfg.Logger,
		sessions:           make(map[string]*sessionRecord),
		idempotent:         make(map[string]idempotencyRecord),
		eventSchemaVersion: eventSchemaVersionV1,
		counter:            1,
		eventQueue:         make(chan eventEnvelope, 128),
	}
	if server.staticDir != "" {
		server.staticDir = filepath.Clean(server.staticDir)
	}
	go server.consumeEvents()

	server.httpServer = &http.Server{
		Addr:              server.addr,
		Handler:           server.routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	return server, nil
}

func (s *Server) ListenAndServe() error {
	return s.httpServer.ListenAndServe()
}

func loadFixtures(path string) (fixtures, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return fixtures{}, fmt.Errorf("read fixtures %s: %w", path, err)
	}

	var data fixtures
	if err := json.Unmarshal(body, &data); err != nil {
		return fixtures{}, fmt.Errorf("parse fixtures %s: %w", path, err)
	}

	return data, nil
}

func (s *Server) routes() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startedAt := time.Now()
		meta := requestMeta{
			RequestID: makeRequestID(),
			TraceID:   incomingTraceID(r),
		}
		r = r.WithContext(context.WithValue(r.Context(), requestMetaKey, meta))

		recorder := &responseRecorder{ResponseWriter: w, statusCode: http.StatusOK}
		s.route(recorder, r)

		s.logger.Printf(
			"request method=%s path=%s status=%d requestId=%s traceId=%s durationMs=%d",
			r.Method,
			r.URL.Path,
			recorder.statusCode,
			meta.RequestID,
			meta.TraceID,
			time.Since(startedAt).Milliseconds(),
		)
	})
}

func (s *Server) route(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/healthz" && r.Method == http.MethodGet {
		s.handleHealthz(w, r)
		return
	}

	if r.URL.Path == "/api/v1/dlq/replay-contract" && r.Method == http.MethodGet {
		s.handleDLQReplayContract(w, r)
		return
	}

	if r.URL.Path == "/api/v1/interview-sessions" && r.Method == http.MethodPost {
		s.handleSessionCollection(w, r)
		return
	}

	const prefix = "/api/v1/interview-sessions/"
	if strings.HasPrefix(r.URL.Path, prefix) {
		sessionID, tail, ok := splitSessionPath(strings.TrimPrefix(r.URL.Path, prefix))
		if !ok {
			s.handleNoRoute(w, r)
			return
		}

		switch {
		case tail == "" && r.Method == http.MethodGet:
			s.handleGetSession(w, r, sessionID)
			return
		case tail == "/questions" && r.Method == http.MethodGet:
			s.handleGetQuestions(w, r, sessionID)
			return
		case tail == "/answers" && r.Method == http.MethodGet:
			s.handleGetAnswers(w, r, sessionID)
			return
		case tail == "/answers" && r.Method == http.MethodPost:
			s.handleSaveAnswer(w, r, sessionID)
			return
		case tail == "/finalize" && r.Method == http.MethodPost:
			s.handleFinalize(w, r, sessionID)
			return
		case tail == "/evaluations" && r.Method == http.MethodPost:
			s.handleSubmitEvaluation(w, r, sessionID)
			return
		case tail == "/result-summary" && r.Method == http.MethodGet:
			s.handleResultSummary(w, r, sessionID)
			return
		}
	}

	if s.tryServeStatic(w, r) {
		return
	}

	s.handleNoRoute(w, r)
}

func splitSessionPath(path string) (string, string, bool) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", "", false
	}

	parts := strings.SplitN(path, "/", 2)
	sessionID := strings.TrimSpace(parts[0])
	if sessionID == "" {
		return "", "", false
	}
	if len(parts) == 1 {
		return sessionID, "", true
	}
	return sessionID, "/" + strings.TrimSpace(parts[1]), true
}
