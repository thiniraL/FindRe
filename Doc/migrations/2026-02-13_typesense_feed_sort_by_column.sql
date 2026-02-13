-- Add column to store pre-computed Typesense _eval sort string for the feed
ALTER TABLE user_activity.USER_PREFERENCES
ADD COLUMN IF NOT EXISTS typesense_feed_sort_by TEXT;

-- Update analyze_user_preferences to build and store the _eval string when building preference_counters
CREATE OR REPLACE FUNCTION analyze_user_preferences(p_session_id VARCHAR(100))
RETURNS VOID AS $$
DECLARE
    v_view_count INT;
    v_bedrooms_avg DECIMAL;
    v_bedrooms_min INT;
    v_bedrooms_max INT;
    v_bathrooms_min INT;
    v_bathrooms_max INT;
    v_price_avg DECIMAL;
    v_price_min DECIMAL;
    v_price_max DECIMAL;
    v_sale_score_raw INT;
    v_rent_score_raw INT;
    v_sale_score INT := 50;
    v_rent_score INT := 50;
    v_total_score INT;
    v_user_id UUID;

    -- JSONB tallies (weighted counts) for preference-based scoring
    v_bedrooms_counts JSONB;
    v_bathrooms_counts JSONB;
    v_price_bucket_counts JSONB;
    v_property_type_counts JSONB;
    v_feature_counts JSONB;
    v_preference_counters JSONB;

    -- Pre-computed Typesense _eval sort string for feed
    v_typesense_feed_sort_by TEXT;
    v_part TEXT;
    v_clauses TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- Count total VALID feedback events (exclude disliked)
    SELECT COUNT(*) INTO v_view_count
    FROM property.PROPERTY_VIEWS
    WHERE session_id = p_session_id
      AND COALESCE(is_disliked, FALSE) = FALSE;

    -- Only analyze if >= 5 valid feedback entries
    IF v_view_count < 5 THEN
        UPDATE user_activity.USER_PREFERENCES
        SET is_ready_for_recommendations = FALSE,
            typesense_feed_sort_by = NULL,
            updated_at = NOW() AT TIME ZONE 'UTC'
        WHERE session_id = p_session_id;
        RETURN;
    END IF;

    -- Get user_id from session
    SELECT user_id
    INTO v_user_id
    FROM user_activity.USER_SESSIONS
    WHERE session_id = p_session_id;

    -- Analyze bedroom preferences (Exclude disliked)
    SELECT
        AVG(pd.bedrooms)::DECIMAL(5,2),
        MIN(pd.bedrooms),
        MAX(pd.bedrooms)
    INTO v_bedrooms_avg, v_bedrooms_min, v_bedrooms_max
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTY_DETAILS pd ON pv.property_id = pd.property_id
    WHERE pv.session_id = p_session_id
        AND COALESCE(pv.is_disliked, FALSE) = FALSE
        AND pd.bedrooms IS NOT NULL;

    -- Analyze bathroom preferences (Exclude disliked)
    SELECT
        MIN(pd.bathrooms),
        MAX(pd.bathrooms)
    INTO v_bathrooms_min, v_bathrooms_max
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTY_DETAILS pd ON pv.property_id = pd.property_id
    WHERE pv.session_id = p_session_id
        AND COALESCE(pv.is_disliked, FALSE) = FALSE
        AND pd.bathrooms IS NOT NULL;

    -- Analyze price preferences (Exclude disliked)
    SELECT
        AVG(p.price)::DECIMAL(15,2),
        MIN(p.price),
        MAX(p.price)
    INTO v_price_avg, v_price_min, v_price_max
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTIES p ON pv.property_id = p.property_id
    WHERE pv.session_id = p_session_id
        AND COALESCE(pv.is_disliked, FALSE) = FALSE
        AND p.price IS NOT NULL;

    -- Analyze Sale vs Rent preference (Weighted: Like=3, Neutral=1, Dislike=0)
    SELECT
        COALESCE(SUM(CASE WHEN pv.is_liked THEN 3 ELSE 1 END) FILTER (WHERE pur.purpose_key = 'for_sale'), 0),
        COALESCE(SUM(CASE WHEN pv.is_liked THEN 3 ELSE 1 END) FILTER (WHERE pur.purpose_key = 'for_rent'), 0)
    INTO v_sale_score_raw, v_rent_score_raw
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTIES p ON pv.property_id = p.property_id
    JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
    WHERE pv.session_id = p_session_id
      AND COALESCE(pv.is_disliked, FALSE) = FALSE;

    -- Calculate preference scores (0-100)
    v_total_score := v_sale_score_raw + v_rent_score_raw;
    IF v_total_score > 0 THEN
        v_sale_score := (v_sale_score_raw * 100 / v_total_score);
        v_rent_score := (v_rent_score_raw * 100 / v_total_score);
    END IF;

    -----------------------------------------------------------------------
    -- JSONB tallies ("tally marks") for fine-grained preference scoring
    -----------------------------------------------------------------------

    -- Bedrooms tally: { "1": weight, "2": weight, ... } (exclude disliked; likes = +3, neutral = +1)
    SELECT COALESCE(
        jsonb_object_agg((t.bedrooms)::text, t.weight),
        '{}'::jsonb
    )
    INTO v_bedrooms_counts
    FROM (
        SELECT
            pd.bedrooms,
            SUM(
                CASE
                    WHEN pv.is_liked THEN 3
                    ELSE 1
                END
            ) AS weight
        FROM property.PROPERTY_VIEWS pv
        JOIN property.PROPERTY_DETAILS pd ON pd.property_id = pv.property_id
        WHERE pv.session_id = p_session_id
          AND COALESCE(pv.is_disliked, FALSE) = FALSE
          AND pd.bedrooms IS NOT NULL
        GROUP BY pd.bedrooms
    ) AS t;

    -- Bathrooms tally: { "1": weight, "2": weight, ... } (exclude disliked; likes = +3, neutral = +1)
    SELECT COALESCE(
        jsonb_object_agg((t.bathrooms)::text, t.weight),
        '{}'::jsonb
    )
    INTO v_bathrooms_counts
    FROM (
        SELECT
            pd.bathrooms,
            SUM(
                CASE
                    WHEN pv.is_liked THEN 3
                    ELSE 1
                END
            ) AS weight
        FROM property.PROPERTY_VIEWS pv
        JOIN property.PROPERTY_DETAILS pd ON pd.property_id = pv.property_id
        WHERE pv.session_id = p_session_id
          AND COALESCE(pv.is_disliked, FALSE) = FALSE
          AND pd.bathrooms IS NOT NULL
        GROUP BY pd.bathrooms
    ) AS t;

    -- Price bucket tally (exclude disliked; likes = +3, neutral = +1)
    SELECT COALESCE(
        jsonb_object_agg(t.bucket, t.weight),
        '{}'::jsonb
    )
    INTO v_price_bucket_counts
    FROM (
        SELECT
            CASE
                WHEN p.price < 1000000 THEN '0-1000000'
                WHEN p.price < 2000000 THEN '1000000-2000000'
                WHEN p.price < 5000000 THEN '2000000-5000000'
                ELSE '5000000+'
            END AS bucket,
            SUM(
                CASE
                    WHEN pv.is_liked THEN 3
                    ELSE 1
                END
            ) AS weight
        FROM property.PROPERTY_VIEWS pv
        JOIN property.PROPERTIES p ON pv.property_id = p.property_id
        WHERE pv.session_id = p_session_id
          AND COALESCE(pv.is_disliked, FALSE) = FALSE
          AND p.price IS NOT NULL
        GROUP BY bucket
    ) AS t;

    -- Property type tally: { "<type_id>": weight, ... } from property_type_ids[] (exclude disliked; likes = +3, neutral = +1)
    SELECT COALESCE(
        jsonb_object_agg((t.type_id)::text, t.weight),
        '{}'::jsonb
    )
    INTO v_property_type_counts
    FROM (
        SELECT
            ptid AS type_id,
            SUM(
                CASE
                    WHEN pv.is_liked THEN 3
                    ELSE 1
                END
            ) AS weight
        FROM property.PROPERTY_VIEWS pv
        JOIN property.PROPERTIES p ON pv.property_id = p.property_id
        CROSS JOIN LATERAL unnest(COALESCE(p.property_type_ids, '{}')) AS ptid
        WHERE pv.session_id = p_session_id
          AND COALESCE(pv.is_disliked, FALSE) = FALSE
        GROUP BY ptid
    ) AS t;

    -- Feature tallies from PROPERTY_DETAILS.features JSONB keys (exclude disliked; likes = +3, neutral = +1)
    SELECT COALESCE(
        jsonb_object_agg(t.feature_key, t.weight),
        '{}'::jsonb
    )
    INTO v_feature_counts
    FROM (
        SELECT
            f.feature_key,
            SUM(
                CASE
                    WHEN pv.is_liked THEN 3
                    ELSE 1
                END
            ) AS weight
        FROM property.PROPERTY_VIEWS pv
        JOIN property.PROPERTY_DETAILS pd ON pd.property_id = pv.property_id
        CROSS JOIN LATERAL unnest(COALESCE(pd.feature_ids, '{}')) AS fid
        JOIN property.FEATURES f ON f.feature_id = fid
        WHERE pv.session_id = p_session_id
          AND COALESCE(pv.is_disliked, FALSE) = FALSE
        GROUP BY f.feature_key
    ) AS t;

    -- Final JSONB preference_counters payload
    v_preference_counters := jsonb_build_object(
        'bedrooms', COALESCE(v_bedrooms_counts, '{}'::jsonb),
        'bathrooms', COALESCE(v_bathrooms_counts, '{}'::jsonb),
        'price_buckets', COALESCE(v_price_bucket_counts, '{}'::jsonb),
        'property_types', COALESCE(v_property_type_counts, '{}'::jsonb),
        'features', COALESCE(v_feature_counts, '{}'::jsonb)
    );

    -----------------------------------------------------------------------
    -- Build Typesense _eval sort string: _eval([(expr):score,...]):desc,updated_at:desc
    -- Same logic as app buildSortByEval; scores clamped 0-127.
    -----------------------------------------------------------------------
    -- Bedrooms: (bedrooms:=k):score
    SELECT string_agg(
        '(bedrooms:=' || key || '):' || LEAST(127, GREATEST(0, (value::numeric)::int)),
        ','
    ) INTO v_part
    FROM jsonb_each_text(COALESCE(v_bedrooms_counts, '{}'::jsonb)) AS t(key, value)
    WHERE (value::numeric)::int > 0;
    IF v_part IS NOT NULL AND v_part <> '' THEN
        v_clauses := array_append(v_clauses, v_part);
    END IF;

    -- Bathrooms: (bathrooms:=k):score
    SELECT string_agg(
        '(bathrooms:=' || key || '):' || LEAST(127, GREATEST(0, (value::numeric)::int)),
        ','
    ) INTO v_part
    FROM jsonb_each_text(COALESCE(v_bathrooms_counts, '{}'::jsonb)) AS t(key, value)
    WHERE (value::numeric)::int > 0;
    IF v_part IS NOT NULL AND v_part <> '' THEN
        v_clauses := array_append(v_clauses, v_part);
    END IF;

    -- Price buckets: (price:[...]):score (map bucket to Typesense filter)
    SELECT string_agg(
        '(' || CASE t.key
            WHEN '0-1000000' THEN 'price:[0..1000000]'
            WHEN '1000000-2000000' THEN 'price:[1000000..2000000]'
            WHEN '2000000-5000000' THEN 'price:[2000000..5000000]'
            WHEN '5000000+' THEN 'price:>=5000000'
            ELSE NULL
        END || '):' || LEAST(127, GREATEST(0, (t.value::numeric)::int)),
        ','
    ) INTO v_part
    FROM jsonb_each_text(COALESCE(v_price_bucket_counts, '{}'::jsonb)) AS t(key, value)
    WHERE (value::numeric)::int > 0
      AND t.key IN ('0-1000000', '1000000-2000000', '2000000-5000000', '5000000+');
    IF v_part IS NOT NULL AND v_part <> '' THEN
        v_clauses := array_append(v_clauses, v_part);
    END IF;

    -- Property types: (property_type_id:=k):score
    SELECT string_agg(
        '(property_type_id:=' || key || '):' || LEAST(127, GREATEST(0, (value::numeric)::int)),
        ','
    ) INTO v_part
    FROM jsonb_each_text(COALESCE(v_property_type_counts, '{}'::jsonb)) AS t(key, value)
    WHERE (value::numeric)::int > 0;
    IF v_part IS NOT NULL AND v_part <> '' THEN
        v_clauses := array_append(v_clauses, v_part);
    END IF;

    -- Features: (features:=key):score (skip empty key)
    SELECT string_agg(
        '(features:=' || key || '):' || LEAST(127, GREATEST(0, (value::numeric)::int)),
        ','
    ) INTO v_part
    FROM jsonb_each_text(COALESCE(v_feature_counts, '{}'::jsonb)) AS t(key, value)
    WHERE (value::numeric)::int > 0 AND key IS NOT NULL AND key <> '';
    IF v_part IS NOT NULL AND v_part <> '' THEN
        v_clauses := array_append(v_clauses, v_part);
    END IF;

    IF array_length(v_clauses, 1) > 0 THEN
        v_typesense_feed_sort_by := '_eval([' || array_to_string(v_clauses, ',') || ']):desc,updated_at:desc';
    ELSE
        v_typesense_feed_sort_by := NULL;
    END IF;

    -- Upsert USER_PREFERENCES
    INSERT INTO user_activity.USER_PREFERENCES (
        session_id,
        user_id,
        preferred_bedrooms_min,
        preferred_bedrooms_max,
        preferred_bedrooms_avg,
        preferred_bathrooms_min,
        preferred_bathrooms_max,
        preferred_price_min,
        preferred_price_max,
        preferred_price_avg,
        preferred_property_type_ids,
        preferred_location_ids,
        preferred_purpose_ids,
        preferred_feature_ids,
        preference_counters,
        typesense_feed_sort_by,
        sale_preference_score,
        rent_preference_score,
        total_properties_viewed,
        unique_properties_viewed,
        is_ready_for_recommendations,
        last_analyzed_at,
        updated_at
    )
    SELECT
        p_session_id,
        v_user_id,
        v_bedrooms_min,
        v_bedrooms_max,
        v_bedrooms_avg,
        v_bathrooms_min,
        v_bathrooms_max,
        v_price_min,
        v_price_max,
        v_price_avg,
        (SELECT ARRAY_AGG(DISTINCT ptid ORDER BY ptid) FROM property.PROPERTY_VIEWS pv2
         JOIN property.PROPERTIES p2 ON p2.property_id = pv2.property_id,
         unnest(COALESCE(p2.property_type_ids, '{}')) AS ptid
         WHERE pv2.session_id = p_session_id AND COALESCE(pv2.is_disliked, FALSE) = FALSE),
        ARRAY_AGG(DISTINCT p.location_id) FILTER (WHERE p.location_id IS NOT NULL),
        ARRAY_AGG(DISTINCT p.purpose_id) FILTER (WHERE p.purpose_id IS NOT NULL),
        (SELECT ARRAY_AGG(DISTINCT fid ORDER BY fid) FROM property.PROPERTY_VIEWS pv2
         JOIN property.PROPERTY_DETAILS pd2 ON pd2.property_id = pv2.property_id,
         unnest(COALESCE(pd2.feature_ids, '{}')) AS fid
         WHERE pv2.session_id = p_session_id AND COALESCE(pv2.is_disliked, FALSE) = FALSE),
        v_preference_counters,
        v_typesense_feed_sort_by,
        v_sale_score,
        v_rent_score,
        v_view_count,
        COUNT(DISTINCT pv.property_id),
        TRUE,
        NOW() AT TIME ZONE 'UTC',
        NOW() AT TIME ZONE 'UTC'
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTIES p ON p.property_id = pv.property_id
    WHERE pv.session_id = p_session_id
      AND COALESCE(pv.is_disliked, FALSE) = FALSE
    GROUP BY p_session_id
    ON CONFLICT (session_id) DO UPDATE SET
        user_id = COALESCE(EXCLUDED.user_id, user_activity.USER_PREFERENCES.user_id),
        preferred_bedrooms_min = EXCLUDED.preferred_bedrooms_min,
        preferred_bedrooms_max = EXCLUDED.preferred_bedrooms_max,
        preferred_bedrooms_avg = EXCLUDED.preferred_bedrooms_avg,
        preferred_bathrooms_min = EXCLUDED.preferred_bathrooms_min,
        preferred_bathrooms_max = EXCLUDED.preferred_bathrooms_max,
        preferred_price_min = EXCLUDED.preferred_price_min,
        preferred_price_max = EXCLUDED.preferred_price_max,
        preferred_price_avg = EXCLUDED.preferred_price_avg,
        preferred_property_type_ids = EXCLUDED.preferred_property_type_ids,
        preferred_location_ids = EXCLUDED.preferred_location_ids,
        preferred_purpose_ids = EXCLUDED.preferred_purpose_ids,
        preferred_feature_ids = EXCLUDED.preferred_feature_ids,
        preference_counters = EXCLUDED.preference_counters,
        typesense_feed_sort_by = EXCLUDED.typesense_feed_sort_by,
        sale_preference_score = EXCLUDED.sale_preference_score,
        rent_preference_score = EXCLUDED.rent_preference_score,
        total_properties_viewed = EXCLUDED.total_properties_viewed,
        unique_properties_viewed = EXCLUDED.unique_properties_viewed,
        is_ready_for_recommendations = TRUE,
        last_analyzed_at = NOW() AT TIME ZONE 'UTC',
        updated_at = NOW() AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql;
