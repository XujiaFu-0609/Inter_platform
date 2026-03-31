-- PostgreSQL baseline schema for M2 readiness.
-- M1 keeps in-memory runtime behavior; this migration is prepared for persistence rollout.

create table if not exists interview_sessions (
    session_id varchar(64) primary key,
    candidate_id varchar(64) not null,
    interview_plan_id varchar(64) not null,
    mode varchar(32) not null,
    status varchar(32) not null,
    created_at timestamptz not null,
    preparing_at timestamptz,
    started_at timestamptz,
    submitted_at timestamptz,
    completed_at timestamptz
);

create table if not exists interview_answers (
    session_id varchar(64) not null references interview_sessions(session_id) on delete cascade,
    question_id varchar(64) not null,
    answer_id varchar(64) not null,
    answer_version integer not null,
    answer_content text not null,
    answer_format varchar(32) not null,
    saved_at timestamptz not null,
    primary key (session_id, question_id, answer_version)
);

create table if not exists interview_evaluations (
    evaluation_id varchar(64) primary key,
    session_id varchar(64) not null references interview_sessions(session_id) on delete cascade,
    summary text not null,
    hire_recommendation varchar(32) not null,
    risk_tags jsonb not null default '[]'::jsonb,
    completed_at timestamptz not null
);

create table if not exists idempotency_records (
    scope varchar(128) not null,
    idempotency_key varchar(128) not null,
    payload_hash varchar(128) not null,
    response_payload jsonb not null,
    created_at timestamptz not null default now(),
    primary key (scope, idempotency_key)
);

create table if not exists event_outbox (
    id bigserial primary key,
    event_id varchar(64) not null unique,
    event_type varchar(128) not null,
    session_id varchar(64) not null,
    payload jsonb not null,
    request_id varchar(64) not null,
    trace_id varchar(64) not null,
    status varchar(32) not null default 'pending',
    retry_count integer not null default 0,
    next_retry_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_event_outbox_status_next_retry
    on event_outbox(status, next_retry_at);

