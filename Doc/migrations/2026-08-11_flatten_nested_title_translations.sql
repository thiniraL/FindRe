-- Flatten nested title_translations: { "en": { "title": "..." } }
-- into the canonical shape: { "en": "..." }
-- Date: 2026-08-11

UPDATE property.PROPERTIES
SET title_translations = (
      SELECT jsonb_object_agg(
        lang,
        CASE
          WHEN jsonb_typeof(val) = 'object' AND val ? 'title'
            THEN to_jsonb(val->>'title')
          ELSE val
        END
      )
      FROM jsonb_each(title_translations) AS t(lang, val)
    ),
    updated_at = (NOW() AT TIME ZONE 'UTC')
WHERE EXISTS (
  SELECT 1
  FROM jsonb_each(title_translations) AS t(lang, val)
  WHERE jsonb_typeof(val) = 'object'
    AND val ? 'title'
);
