BEGIN;

CREATE TABLE IF NOT EXISTS tq_quran_audio_jobs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES tq_workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES tq_projects(id) ON DELETE CASCADE,
  requested_by text NOT NULL REFERENCES tq_users(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'alquran.cloud',
  edition text NOT NULL,
  qari_name text NOT NULL,
  surah_number integer NOT NULL,
  ayah_start integer NOT NULL,
  ayah_end integer NOT NULL,
  source_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0,
  output_asset_id text REFERENCES tq_media_assets(id) ON DELETE SET NULL,
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  cache_hit boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT tq_quran_audio_jobs_surah_check CHECK (surah_number BETWEEN 1 AND 114),
  CONSTRAINT tq_quran_audio_jobs_ayah_check CHECK (ayah_start >= 1 AND ayah_end >= ayah_start),
  CONSTRAINT tq_quran_audio_jobs_progress_check CHECK (progress BETWEEN 0 AND 100),
  CONSTRAINT tq_quran_audio_jobs_status_check CHECK (status IN ('queued','downloading','merging','storing','complete','failed'))
);

CREATE INDEX IF NOT EXISTS tq_quran_audio_jobs_workspace_idx
  ON tq_quran_audio_jobs(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS tq_quran_audio_jobs_project_idx
  ON tq_quran_audio_jobs(project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS tq_quran_audio_jobs_source_idx
  ON tq_quran_audio_jobs(workspace_id,source_key,status);
CREATE UNIQUE INDEX IF NOT EXISTS tq_quran_audio_asset_source_idx
  ON tq_media_assets(workspace_id,(metadata->>'sourceKey'))
  WHERE archived_at IS NULL AND metadata ? 'sourceKey';

INSERT INTO tq_schema_migrations(version) VALUES ('004-quran-audio-jobs') ON CONFLICT DO NOTHING;

COMMIT;
