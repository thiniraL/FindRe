-- =============================================================================
-- Rebalance Typesense _eval weights: beds/baths/price >> features
-- =============================================================================
-- Problem: raw feature counters (pool:30, lift:27, …) stacked above structural
-- prefs, so luxury featured homes outranked clear 2-bed / price matches.
--
-- Fix:
--   beds/baths/price × 4 (cap 127)
--   property_types × 2
--   features: top 8 only, each score = min(5, raw/10)
--
-- Also rebuilds stored typesense_feed_sort_by for ready preference rows.
-- =============================================================================

CREATE OR REPLACE FUNCTION user_activity.build_typesense_feed_sort_by(p_counters JSONB)
RETURNS TEXT AS $$
DECLARE
    v_clauses TEXT[] := ARRAY[]::TEXT[];
    v_part TEXT;
    v_bedrooms JSONB;
    v_bathrooms JSONB;
    v_price JSONB;
    v_types JSONB;
    v_features JSONB;
BEGIN
    IF p_counters IS NULL OR p_counters = '{}'::jsonb THEN
        RETURN NULL;
    END IF;

    v_bedrooms := COALESCE(p_counters->'bedrooms', '{}'::jsonb);
    v_bathrooms := COALESCE(p_counters->'bathrooms', '{}'::jsonb);
    v_price := COALESCE(p_counters->'price_buckets', '{}'::jsonb);
    v_types := COALESCE(p_counters->'property_types', '{}'::jsonb);
    v_features := COALESCE(p_counters->'features', '{}'::jsonb);

    -- Bedrooms × 4
    SELECT string_agg(
        '(bedrooms:=' || key || '):' || LEAST(127, GREATEST(0, ((value::numeric) * 4)::int)),
        ','
    ) INTO v_part
    FROM jsonb_each_text(v_bedrooms) AS t(key, value)
    WHERE (value::numeric)::int > 0;
    IF v_part IS NOT NULL AND v_part <> '' THEN
        v_clauses := array_append(v_clauses, v_part);
    END IF;

    -- Bathrooms × 4
    SELECT string_agg(
        '(bathrooms:=' || key || '):' || LEAST(127, GREATEST(0, ((value::numeric) * 4)::int)),
        ','
    ) INTO v_part
    FROM jsonb_each_text(v_bathrooms) AS t(key, value)
    WHERE (value::numeric)::int > 0;
    IF v_part IS NOT NULL AND v_part <> '' THEN
        v_clauses := array_append(v_clauses, v_part);
    END IF;

    -- Price buckets × 4
    SELECT string_agg(
        '(' || CASE t.key
            WHEN '0-1000000' THEN 'price:[0..1000000]'
            WHEN '1000000-2000000' THEN 'price:[1000000..2000000]'
            WHEN '2000000-5000000' THEN 'price:[2000000..5000000]'
            WHEN '5000000+' THEN 'price:>=5000000'
            ELSE NULL
        END || '):' || LEAST(127, GREATEST(0, ((t.value::numeric) * 4)::int)),
        ','
    ) INTO v_part
    FROM jsonb_each_text(v_price) AS t(key, value)
    WHERE (value::numeric)::int > 0
      AND t.key IN ('0-1000000', '1000000-2000000', '2000000-5000000', '5000000+');
    IF v_part IS NOT NULL AND v_part <> '' THEN
        v_clauses := array_append(v_clauses, v_part);
    END IF;

    -- Property types × 2
    SELECT string_agg(
        '(property_type_id:=' || key || '):' || LEAST(127, GREATEST(0, ((value::numeric) * 2)::int)),
        ','
    ) INTO v_part
    FROM jsonb_each_text(v_types) AS t(key, value)
    WHERE (value::numeric)::int > 0;
    IF v_part IS NOT NULL AND v_part <> '' THEN
        v_clauses := array_append(v_clauses, v_part);
    END IF;

    -- Top 8 features only; each min(5, raw/10)
    SELECT string_agg(
        '(features:=' || key || '):' || score::text,
        ','
    ) INTO v_part
    FROM (
        SELECT
            key,
            LEAST(5, GREATEST(0, FLOOR((value::numeric) / 10.0)::int)) AS score
        FROM jsonb_each_text(v_features) AS t(key, value)
        WHERE key IS NOT NULL AND key <> '' AND (value::numeric)::int > 0
        ORDER BY (value::numeric) DESC, key
        LIMIT 8
    ) AS top_feat
    WHERE score > 0;
    IF v_part IS NOT NULL AND v_part <> '' THEN
        v_clauses := array_append(v_clauses, v_part);
    END IF;

    IF array_length(v_clauses, 1) > 0 THEN
        RETURN '_eval([' || array_to_string(v_clauses, ',') || ']):desc,updated_at:desc';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION user_activity.build_typesense_feed_sort_by(JSONB) IS
  'Build Typesense _eval sort: beds/baths/price×4, types×2, top-8 features capped';

-- Rebuild stored sort strings for ready users (app also rebuilds from counters)
UPDATE user_activity.USER_PREFERENCES
SET
    typesense_feed_sort_by = user_activity.build_typesense_feed_sort_by(preference_counters),
    updated_at = NOW() AT TIME ZONE 'UTC'
WHERE is_ready_for_recommendations = TRUE
  AND preference_counters IS NOT NULL;
