package httpapi

import (
	"log"
	"net/http"
	"sync"
)

type Config struct {
	Addr        string
	FixturePath string
	StaticDir   string
	Logger      *log.Logger
}

type Server struct {
	addr               string
	staticDir          string
	fixtures           fixtures
	logger             *log.Logger
	mu                 sync.Mutex
	sessions           map[string]*sessionRecord
	idempotent         map[string]idempotencyRecord
	eventSchemaVersion string
	dlqRecords         []deadLetterRecord
	counter            int
	httpServer         *http.Server
	eventQueue         chan eventEnvelope
}

type fixtures struct {
	Candidate     candidate     `json:"candidate"`
	InterviewPlan interviewPlan `json:"interviewPlan"`
	Questions     []question    `json:"questions"`
	ResultSummary resultSummary `json:"resultSummary"`
}

type candidate struct {
	CandidateID string `json:"candidateId"`
	Name        string `json:"name"`
	TargetRole  string `json:"targetRole"`
}

type interviewPlan struct {
	InterviewPlanID           string `json:"interviewPlanId"`
	Title                     string `json:"title"`
	Mode                      string `json:"mode"`
	InterviewerID             string `json:"interviewerId"`
	InterviewerName           string `json:"interviewerName"`
	PlannedDurationMinutes    int    `json:"plannedDurationMinutes"`
	QuestionSetPolicyResolved string `json:"questionSetPolicyResolved"`
}

type question struct {
	QuestionID  string   `json:"questionId"`
	SequenceNo  int      `json:"sequenceNo"`
	Type        string   `json:"type"`
	Title       string   `json:"title"`
	Stem        string   `json:"stem"`
	Constraints []string `json:"constraints"`
}

type resultSummary struct {
	Summary            string           `json:"summary"`
	DimensionScores    []dimensionScore `json:"dimensionScores"`
	HireRecommendation string           `json:"hireRecommendation"`
	RiskTags           []string         `json:"riskTags"`
	Findings           []string         `json:"findings"`
}

type dimensionScore struct {
	Dimension string `json:"dimension"`
	Score     int    `json:"score"`
}

type createSessionPayload struct {
	CandidateID     string `json:"candidateId"`
	InterviewPlanID string `json:"interviewPlanId"`
	Mode            string `json:"mode"`
	EntryToken      string `json:"entryToken"`
}

type saveAnswerPayload struct {
	QuestionID     string `json:"questionId"`
	AnswerContent  string `json:"answerContent"`
	AnswerFormat   string `json:"answerFormat"`
	ClientSavedAt  string `json:"clientSavedAt"`
	IdempotencyKey string `json:"idempotencyKey"`
}

type finalizePayload struct {
	FinalizedAt    string `json:"finalizedAt"`
	IdempotencyKey string `json:"idempotencyKey"`
}

type submitEvaluationPayload struct {
	Scores             []dimensionScore `json:"scores"`
	Summary            string           `json:"summary"`
	HireRecommendation string           `json:"hireRecommendation"`
	RiskTags           []string         `json:"riskTags"`
	IdempotencyKey     string           `json:"idempotencyKey"`
}

type sessionRecord struct {
	SessionID       string
	CandidateID     string
	InterviewPlanID string
	Mode            string
	EntryToken      string
	Status          string
	CreatedAt       string
	PreparingAt     *string
	StartedAt       *string
	SubmittedAt     *string
	CompletedAt     *string
	PollCount       int
	Answers         map[string]*answerRecord
}

type answerRecord struct {
	QuestionID    string
	AnswerID      string
	AnswerContent string
	AnswerFormat  string
	AnswerVersion int
	SavedAt       string
}

type idempotencyRecord struct {
	PayloadHash string
	Response    map[string]any
}

type eventEnvelope struct {
	EventID       string         `json:"eventId"`
	EventType     string         `json:"eventType"`
	SchemaVersion string         `json:"schemaVersion"`
	OccurredAt    string         `json:"occurredAt"`
	RequestID     string         `json:"requestId"`
	TraceID       string         `json:"traceId"`
	SessionID     string         `json:"sessionId"`
	Payload       map[string]any `json:"payload"`
}

type deadLetterRecord struct {
	Envelope          eventEnvelope `json:"envelope"`
	Reason            string        `json:"reason"`
	ReplayKey         string        `json:"replayKey"`
	PayloadHash       string        `json:"payloadHash"`
	FirstFailedAt     string        `json:"firstFailedAt"`
	ReplayConstraints []string      `json:"replayConstraints"`
}
