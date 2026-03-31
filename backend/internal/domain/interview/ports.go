package interview

import "context"

type SessionRepository interface {
	GetByID(ctx context.Context, sessionID string) (*Session, error)
	Save(ctx context.Context, session *Session) error
}

type IdempotencyRepository interface {
	Claim(ctx context.Context, scope string, key string, payloadHash string, response map[string]any) (replay map[string]any, conflict bool, err error)
}

type EventPublisher interface {
	Publish(ctx context.Context, event EventEnvelope) error
}
