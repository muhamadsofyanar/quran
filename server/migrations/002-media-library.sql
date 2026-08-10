BEGIN;

ALTER TABLE tq_media_assets
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'generic';
ALTER TABLE tq_media_assets
  ADD COLUMN IF NOT EXISTS surah_number integer;
ALTER TABLE tq_media_assets
  ADD COLUMN IF NOT EXISTS ayah_start integer;
ALTER TABLE tq_media_assets
  ADD COLUMN IF NOT EXISTS ayah_end integer;
ALTER TABLE tq_media_assets
  ADD COLUMN IF NOT EXISTS qari text;
ALTER TABLE tq_media_assets
  ADD COLUMN IF NOT EXISTS duration_seconds numeric(12,3);
ALTER TABLE tq_media_assets
  ADD COLUMN IF NOT EXISTS analysis_status text NOT NULL DEFAULT 'pending';
ALTER TABLE tq_media_assets
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tq_media_assets
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE tq_media_assets
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
ALTER TABLE tq_media_assets
  ADD COLUMN IF NOT EXISTS parent_asset_id text REFERENCES tq_media_assets(id) ON DELETE SET NULL;

ALTER TABLE tq_media_assets DROP CONSTRAINT IF EXISTS tq_media_assets_project_id_fkey;
ALTER TABLE tq_media_assets ADD CONSTRAINT tq_media_assets_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES tq_projects(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tq_media_assets_scope_check') THEN
    ALTER TABLE tq_media_assets ADD CONSTRAINT tq_media_assets_scope_check
      CHECK (scope IN ('generic','surah','ayah'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tq_media_assets_analysis_status_check') THEN
    ALTER TABLE tq_media_assets ADD CONSTRAINT tq_media_assets_analysis_status_check
      CHECK (analysis_status IN ('pending','analyzing','analyzed','needs-review','failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tq_media_assets_surah_check') THEN
    ALTER TABLE tq_media_assets ADD CONSTRAINT tq_media_assets_surah_check
      CHECK (surah_number IS NULL OR surah_number BETWEEN 1 AND 114);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tq_media_assets_ayah_range_check') THEN
    ALTER TABLE tq_media_assets ADD CONSTRAINT tq_media_assets_ayah_range_check
      CHECK ((ayah_start IS NULL OR ayah_start >= 1) AND (ayah_end IS NULL OR ayah_end >= COALESCE(ayah_start,1)));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tq_media_workspace_library_idx
  ON tq_media_assets(workspace_id, kind, created_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS tq_media_quran_idx
  ON tq_media_assets(workspace_id, surah_number, ayah_start, ayah_end)
  WHERE archived_at IS NULL;

ALTER TABLE tq_render_jobs
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;
ALTER TABLE tq_render_jobs
  ADD COLUMN IF NOT EXISTS batch_id text;
CREATE INDEX IF NOT EXISTS tq_render_batch_idx ON tq_render_jobs(workspace_id,batch_id,created_at DESC);

INSERT INTO tq_schema_migrations(version) VALUES ('002-media-library') ON CONFLICT DO NOTHING;

COMMIT;
