-- PostgreSQL schema draft for Pi v4 ExecutionKernel.
-- Adapt naming/types to existing packages/db migration style.

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  plan_execution_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  current_deadline_at TIMESTAMPTZ,
  terminal_reason TEXT,
  owner_controller_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plan_execution_id, workspace_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS attempt_events (
  seq BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_version INTEGER NOT NULL,
  plan_execution_id TEXT NOT NULL,
  workspace_id TEXT,
  attempt_id TEXT,
  command_id TEXT,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attempt_events_attempt_seq
  ON attempt_events(attempt_id, seq);

CREATE TABLE IF NOT EXISTS attempt_transitions (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  triggering_event_id TEXT NOT NULL REFERENCES attempt_events(event_id),
  expected_version INTEGER NOT NULL,
  committed_version INTEGER NOT NULL,
  controller_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS controller_inbox (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_version INTEGER NOT NULL,
  plan_execution_id TEXT NOT NULL,
  workspace_id TEXT,
  attempt_id TEXT,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_controller_inbox_pending
  ON controller_inbox(status, created_at);

CREATE TABLE IF NOT EXISTS controller_leases (
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  controller_id TEXT NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(scope, scope_id)
);

CREATE TABLE IF NOT EXISTS handoff_queue (
  id TEXT PRIMARY KEY,
  plan_execution_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  reason TEXT NOT NULL,
  artifact_id TEXT,
  state TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_handoff_queue_open
  ON handoff_queue(state, created_at);
