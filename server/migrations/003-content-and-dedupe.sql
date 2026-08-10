BEGIN;

-- TQ-12: recognize legacy Qur'an audio names that were uploaded before the media library existed.
UPDATE tq_media_assets
SET scope='ayah',
    surah_number=substring(original_name from '^([0-9]{3})[0-9]{3}\.[^.]+$')::integer,
    ayah_start=substring(original_name from '^[0-9]{3}([0-9]{3})\.[^.]+$')::integer,
    ayah_end=substring(original_name from '^[0-9]{3}([0-9]{3})\.[^.]+$')::integer
WHERE kind='audio'
  AND scope='generic'
  AND original_name ~ '^[0-9]{6}\.[A-Za-z0-9]+$'
  AND substring(original_name from '^([0-9]{3})')::integer BETWEEN 1 AND 114
  AND substring(original_name from '^[0-9]{3}([0-9]{3})')::integer >= 1;

UPDATE tq_media_assets
SET scope='surah',
    surah_number=substring(original_name from '^0*([0-9]{1,3})\.[^.]+$')::integer,
    ayah_start=1
WHERE kind='audio'
  AND scope='generic'
  AND original_name ~ '^[0-9]{4}\.[A-Za-z0-9]+$'
  AND substring(original_name from '^0*([0-9]{1,3})')::integer BETWEEN 1 AND 114;

CREATE INDEX IF NOT EXISTS tq_media_checksum_dedupe_idx
  ON tq_media_assets(workspace_id,kind,checksum,created_at)
  WHERE archived_at IS NULL;

-- Archive legacy duplicate uploads while keeping the best canonical copy visible.
WITH ranked AS (
  SELECT id,
         first_value(id) OVER (PARTITION BY workspace_id,kind,checksum ORDER BY (analysis_status='analyzed') DESC,last_used_at DESC NULLS LAST,created_at ASC) AS canonical_id,
         row_number() OVER (PARTITION BY workspace_id,kind,checksum ORDER BY (analysis_status='analyzed') DESC,last_used_at DESC NULLS LAST,created_at ASC) AS rn
  FROM tq_media_assets
  WHERE archived_at IS NULL
)
UPDATE tq_media_assets a
SET archived_at=now(),
    metadata=COALESCE(a.metadata,'{}'::jsonb) || jsonb_build_object('duplicateOf',r.canonical_id,'deduplicatedByMigration','003-content-and-dedupe')
FROM ranked r
WHERE a.id=r.id AND r.rn>1;

-- Preferred QuranEnc sources are recorded for operational visibility.
INSERT INTO tq_translation_sources(id,edition,language,name,author,source_url,license_name,license_url,enabled,metadata)
VALUES
  ('quranenc-indonesian-affairs','quranenc:indonesian_affairs','id','Indonesia — Kementerian Agama RI','Kementerian Agama Republik Indonesia','https://quranenc.com/api/v1/translation/sura/indonesian_affairs/{surah}','QuranEnc republication terms','https://quranenc.com/id/home',true,'{"provider":"quranenc","providerKey":"indonesian_affairs","kind":"translation","version":"1.0.1","onDemand":true}'::jsonb),
  ('quranenc-indonesian-sabiq','quranenc:indonesian_sabiq','id','Indonesia — PT. Sabiq','PT. Sabiq / Pusat Terjemah Ruwwad','https://quranenc.com/api/v1/translation/sura/indonesian_sabiq/{surah}','QuranEnc republication terms','https://quranenc.com/id/home',true,'{"provider":"quranenc","providerKey":"indonesian_sabiq","kind":"translation","version":"1.1.3","onDemand":true}'::jsonb),
  ('quranenc-indonesian-mokhtasar','quranenc:indonesian_mokhtasar','id','Tafsir Al-Mukhtasar — Indonesia','Markaz Tafsir Li Ad-Dirasat Al-Quraniyyah','https://quranenc.com/api/v1/translation/sura/indonesian_mokhtasar/{surah}','QuranEnc republication terms','https://quranenc.com/id/home',true,'{"provider":"quranenc","providerKey":"indonesian_mokhtasar","kind":"tafsir","version":"1.0.0","onDemand":true}'::jsonb)
ON CONFLICT (edition) DO UPDATE SET
  language=EXCLUDED.language,
  name=EXCLUDED.name,
  author=EXCLUDED.author,
  source_url=EXCLUDED.source_url,
  license_name=EXCLUDED.license_name,
  license_url=EXCLUDED.license_url,
  enabled=EXCLUDED.enabled,
  metadata=EXCLUDED.metadata,
  updated_at=now();

INSERT INTO tq_schema_migrations(version) VALUES ('003-content-and-dedupe') ON CONFLICT DO NOTHING;

COMMIT;
