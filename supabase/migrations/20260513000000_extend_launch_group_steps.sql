/*
  # Extend launch_group_steps with health-check tuning and failure handling

  Adds three columns so steps can express:
  - acceptable_statuses: HTTP status codes treated as healthy by wait_for_health
  - timeout_ms: per-step gate timeout (NULL → daemon default 120000ms)
  - continue_on_failure: when true, a failed step does not abort the group

  Defaults preserve existing behavior:
  - acceptable_statuses '{200,201,204}' matches the prior 2xx success set
  - timeout_ms NULL falls back to the daemon's existing 120s window
  - continue_on_failure false keeps the "first failure aborts" semantics
*/

ALTER TABLE launch_group_steps
  ADD COLUMN IF NOT EXISTS acceptable_statuses int[] NOT NULL DEFAULT '{200,201,204}',
  ADD COLUMN IF NOT EXISTS timeout_ms int,
  ADD COLUMN IF NOT EXISTS continue_on_failure boolean NOT NULL DEFAULT false;
