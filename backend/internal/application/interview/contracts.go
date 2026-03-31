package interview

import "context"

type CreateSessionRequest struct {
	CandidateID     string
	InterviewPlanID string
	Mode            string
	EntryToken      string
}

type SaveAnswerRequest struct {
	SessionID      string
	QuestionID     string
	AnswerContent  string
	AnswerFormat   string
	IdempotencyKey string
	ClientSavedAt  string
}

type FinalizeSessionRequest struct {
	SessionID      string
	FinalizedAt    string
	IdempotencyKey string
}

type SubmitEvaluationRequest struct {
	SessionID          string
	Summary            string
	HireRecommendation string
	RiskTags           []string
	IdempotencyKey     string
}

type SessionUseCase interface {
	CreateSession(ctx context.Context, req CreateSessionRequest) (map[string]any, error)
	GetSession(ctx context.Context, sessionID string) (map[string]any, error)
	SaveAnswer(ctx context.Context, req SaveAnswerRequest) (map[string]any, error)
	FinalizeSession(ctx context.Context, req FinalizeSessionRequest) (map[string]any, error)
	SubmitEvaluation(ctx context.Context, req SubmitEvaluationRequest) (map[string]any, error)
}
