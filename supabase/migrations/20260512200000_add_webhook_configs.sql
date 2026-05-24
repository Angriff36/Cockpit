/*
  # Webhook Configurations

  Stores per-project webhook URLs that receive POST notifications on lifecycle events.
  Events: daemon.start, daemon.stop, deploy.triggered, deploy.completed,
          port.health_failure, sync.completed, process.started, process.exited
*/

CREATE TABLE IF NOT EXISTS webhook_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  url text NOT NULL,
  label text NOT NULL DEFAULT '',
  events text NOT NULL DEFAULT 'daemon.start,daemon.stop,deploy.triggered,deploy.completed,port.health_failure,sync.completed',
  secret text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE webhook_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select webhooks" ON webhook_configs FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners insert webhooks" ON webhook_configs FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners update webhooks" ON webhook_configs FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners delete webhooks" ON webhook_configs FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_webhooks_project ON webhook_configs(project_id);

-- Webhook delivery log for debugging and retry tracking
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  webhook_config_id uuid NOT NULL REFERENCES webhook_configs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',  -- pending, success, failed, retrying
  status_code integer,
  response_body text,
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners select deliveries" ON webhook_deliveries FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owners delete deliveries" ON webhook_deliveries FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_deliveries_webhook ON webhook_deliveries(webhook_config_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON webhook_deliveries(status);
