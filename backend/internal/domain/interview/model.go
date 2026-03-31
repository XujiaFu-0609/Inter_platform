package interview

type SessionStatus string

const (
	SessionStatusPending    SessionStatus = "pending"
	SessionStatusPreparing  SessionStatus = "preparing"
	SessionStatusInProgress SessionStatus = "in_progress"
	SessionStatusSubmitted  SessionStatus = "submitted"
	SessionStatusCompleted  SessionStatus = "completed"
)

type Session struct {
	SessionID       string
	CandidateID     string
	InterviewPlanID string
	Mode            string
	Status          SessionStatus
	CreatedAt       string
	PreparingAt     *string
	StartedAt       *string
	SubmittedAt     *string
	CompletedAt     *string
}

type Answer struct {
	QuestionID    string
	AnswerID      string
	AnswerContent string
	AnswerFormat  string
	AnswerVersion int
	SavedAt       string
}

type EventEnvelope struct {
	EventID       string
	EventType     string
	SchemaVersion string
	OccurredAt    string
	RequestID     string
	TraceID       string
	SessionID     string
	Payload       map[string]any
}
