-- Track successful LINE report claims for the metabolism quiz.
-- Other tool session tables already expose claimed_by / claimed_at; quiz_sessions
-- needs the same fields so the website -> LINE handoff can be measured directly.

ALTER TABLE quiz_sessions
  ADD COLUMN IF NOT EXISTS claimed_by TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_claimed_at
  ON quiz_sessions(claimed_at DESC)
  WHERE claimed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_claimed_by
  ON quiz_sessions(claimed_by)
  WHERE claimed_by IS NOT NULL;
