BEGIN;

CREATE TABLE IF NOT EXISTS tq_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tq_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES tq_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tq_sessions_user_idx ON tq_sessions(user_id);
CREATE INDEX IF NOT EXISTS tq_sessions_expiry_idx ON tq_sessions(expires_at);

CREATE TABLE IF NOT EXISTS tq_workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_by text NOT NULL REFERENCES tq_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tq_memberships (
  workspace_id text NOT NULL REFERENCES tq_workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES tq_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'reviewer', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS tq_memberships_user_idx ON tq_memberships(user_id);

CREATE TABLE IF NOT EXISTS tq_projects (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES tq_workspaces(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES tq_users(id),
  title text NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS tq_projects_workspace_idx ON tq_projects(workspace_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS tq_media_assets (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES tq_workspaces(id) ON DELETE CASCADE,
  project_id text REFERENCES tq_projects(id) ON DELETE CASCADE,
  uploaded_by text NOT NULL REFERENCES tq_users(id),
  kind text NOT NULL CHECK (kind IN ('audio', 'background', 'render-input', 'render-output', 'logo', 'other')),
  storage_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tq_media_project_idx ON tq_media_assets(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tq_render_jobs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES tq_workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES tq_projects(id) ON DELETE CASCADE,
  requested_by text NOT NULL REFERENCES tq_users(id),
  input_asset_id text REFERENCES tq_media_assets(id),
  output_asset_id text REFERENCES tq_media_assets(id),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'complete', 'failed', 'cancelled')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  preset jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS tq_render_workspace_idx ON tq_render_jobs(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tq_comments (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES tq_workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES tq_projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES tq_users(id),
  at_seconds numeric(12,3) NOT NULL DEFAULT 0,
  body text NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tq_approvals (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES tq_workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES tq_projects(id) ON DELETE CASCADE,
  reviewer_id text NOT NULL REFERENCES tq_users(id),
  project_version integer NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'changes-requested')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tq_translation_sources (
  id text PRIMARY KEY,
  edition text NOT NULL UNIQUE,
  language text NOT NULL,
  name text NOT NULL,
  author text,
  source_url text NOT NULL,
  license_name text NOT NULL,
  license_url text,
  enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tq_audit_log (
  id bigserial PRIMARY KEY,
  workspace_id text,
  actor_id text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tq_audit_workspace_idx ON tq_audit_log(workspace_id, created_at DESC);

CREATE OR REPLACE FUNCTION tq_deny_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tq_audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tq_audit_immutable ON tq_audit_log;
CREATE TRIGGER tq_audit_immutable BEFORE UPDATE OR DELETE ON tq_audit_log
FOR EACH ROW EXECUTE FUNCTION tq_deny_audit_mutation();

CREATE TABLE IF NOT EXISTS tq_schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tq_schema_migrations(version) VALUES ('001-production') ON CONFLICT DO NOTHING;

COMMIT;
