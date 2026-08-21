-- =============================================================================
-- Sync USER_PREFERENCES across all sessions for the same logged-in user
-- =============================================================================
-- Run this entire file in Supabase / Postgres SQL Editor.
--
-- Rules:
--   1) Guest (no user_id): analyze + store prefs by session_id (unchanged).
--   2) Logged-in: analyze ALL non-disliked views for that user_id, then write
--      the same preference row to every USER_PREFERENCES / USER_SESSIONS for
--      that user (so two devices / session_ids stay in sync).
--   3) Ready = every is_featured=TRUE property has ANY view (like, dislike, or
--      plain view) by user_id when logged in, else by session_id.
--      (Dislikes still excluded from preference counter math.)
-- =============================================================================

-- Helper: logged-in user has viewed every featured listing (like OR dislike OR view)
CREATE OR REPLACE FUNCTION user_activity.user_viewed_all_featured(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_featured_count INT;
    v_unviewed_exists BOOLEAN;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT COUNT(*)::INT
    INTO v_featured_count
    FROM property.PROPERTIES
    WHERE is_featured = TRUE;

    IF v_featured_count = 0 THEN
        RETURN FALSE;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM property.PROPERTIES p
        WHERE p.is_featured = TRUE
          AND NOT EXISTS (
              SELECT 1
              FROM property.PROPERTY_VIEWS pv
              WHERE pv.property_id = p.property_id
                AND pv.user_id = p_user_id
          )
    )
    INTO v_unviewed_exists;

    RETURN NOT v_unviewed_exists;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION user_activity.user_viewed_all_featured(UUID) IS
  'TRUE when user has any view (like or dislike) for every PROPERTIES.is_featured=TRUE listing';

-- Session helper: if session is linked to a user, use user-scoped ready check
CREATE OR REPLACE FUNCTION user_activity.session_viewed_all_featured(p_session_id VARCHAR(100))
RETURNS BOOLEAN AS $$
DECLARE
    v_featured_count INT;
    v_unviewed_exists BOOLEAN;
    v_user_id UUID;
BEGIN
    SELECT user_id
    INTO v_user_id
    FROM user_activity.USER_SESSIONS
    WHERE session_id = p_session_id;

    IF v_user_id IS NOT NULL THEN
        RETURN user_activity.user_viewed_all_featured(v_user_id);
    END IF;

    SELECT COUNT(*)::INT
    INTO v_featured_count
    FROM property.PROPERTIES
    WHERE is_featured = TRUE;

    IF v_featured_count = 0 THEN
        RETURN FALSE;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM property.PROPERTIES p
        WHERE p.is_featured = TRUE
          AND NOT EXISTS (
              SELECT 1
              FROM property.PROPERTY_VIEWS pv
              WHERE pv.property_id = p.property_id
                AND pv.session_id = p_session_id
          )
    )
    INTO v_unviewed_exists;

    RETURN NOT v_unviewed_exists;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION user_activity.session_viewed_all_featured(VARCHAR) IS
  'TRUE when session (or its linked user) has any view (like or dislike) for every featured listing';

-- -----------------------------------------------------------------------------
-- analyze_user_preferences: user-scoped analysis + sync all session prefs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION analyze_user_preferences(p_session_id VARCHAR(100))
RETURNS VOID AS $$
DECLARE
    v_view_count INT;
    v_unique_count INT;
    v_is_ready BOOLEAN;
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

    v_preferred_property_type_ids INT[];
    v_preferred_location_ids INT[];
    v_preferred_purpose_ids INT[];
    v_preferred_feature_ids INT[];

    v_bedrooms_counts JSONB;
    v_bathrooms_counts JSONB;
    v_price_bucket_counts JSONB;
    v_property_type_counts JSONB;
    v_feature_counts JSONB;
    v_preference_counters JSONB;

    v_typesense_feed_sort_by TEXT;
    v_part TEXT;
    v_clauses TEXT[] := ARRAY[]::TEXT[];
BEGIN
    SELECT user_id
    INTO v_user_id
    FROM user_activity.USER_SESSIONS
    WHERE session_id = p_session_id;

    IF v_user_id IS NOT NULL THEN
        SELECT COUNT(*)::INT, COUNT(DISTINCT property_id)::INT
        INTO v_view_count, v_unique_count
        FROM property.PROPERTY_VIEWS
        WHERE user_id = v_user_id
          AND COALESCE(is_disliked, FALSE) = FALSE;

        v_is_ready := user_activity.user_viewed_all_featured(v_user_id);
    ELSE
        SELECT COUNT(*)::INT, COUNT(DISTINCT property_id)::INT
        INTO v_view_count, v_unique_count
        FROM property.PROPERTY_VIEWS
        WHERE session_id = p_session_id
          AND COALESCE(is_disliked, FALSE) = FALSE;

        v_is_ready := user_activity.session_viewed_all_featured(p_session_id);
    END IF;

    -- Too few views and not ready yet: force not ready (all user sessions if logged in)
    IF v_view_count < 5 AND NOT v_is_ready THEN
        IF v_user_id IS NOT NULL THEN
            UPDATE user_activity.USER_PREFERENCES
            SET is_ready_for_recommendations = FALSE,
                updated_at = NOW() AT TIME ZONE 'UTC'
            WHERE user_id = v_user_id
               OR session_id = p_session_id;
        ELSE
            UPDATE user_activity.USER_PREFERENCES
            SET is_ready_for_recommendations = FALSE,
                updated_at = NOW() AT TIME ZONE 'UTC'
            WHERE session_id = p_session_id;
        END IF;
        RETURN;
    END IF;

    SELECT
        AVG(pd.bedrooms)::DECIMAL(5,2),
        MIN(pd.bedrooms),
        MAX(pd.bedrooms)
    INTO v_bedrooms_avg, v_bedrooms_min, v_bedrooms_max
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTY_DETAILS pd ON pv.property_id = pd.property_id
    WHERE COALESCE(pv.is_disliked, FALSE) = FALSE
      AND pd.bedrooms IS NOT NULL
      AND (
          (v_user_id IS NOT NULL AND pv.user_id = v_user_id)
          OR (v_user_id IS NULL AND pv.session_id = p_session_id)
      );

    SELECT
        MIN(pd.bathrooms),
        MAX(pd.bathrooms)
    INTO v_bathrooms_min, v_bathrooms_max
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTY_DETAILS pd ON pv.property_id = pd.property_id
    WHERE COALESCE(pv.is_disliked, FALSE) = FALSE
      AND pd.bathrooms IS NOT NULL
      AND (
          (v_user_id IS NOT NULL AND pv.user_id = v_user_id)
          OR (v_user_id IS NULL AND pv.session_id = p_session_id)
      );

    SELECT
        AVG(p.price)::DECIMAL(15,2),
        MIN(p.price),
        MAX(p.price)
    INTO v_price_avg, v_price_min, v_price_max
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTIES p ON pv.property_id = p.property_id
    WHERE COALESCE(pv.is_disliked, FALSE) = FALSE
      AND p.price IS NOT NULL
      AND (
          (v_user_id IS NOT NULL AND pv.user_id = v_user_id)
          OR (v_user_id IS NULL AND pv.session_id = p_session_id)
      );

    SELECT
        COALESCE(SUM(CASE WHEN pv.is_liked THEN 3 ELSE 1 END) FILTER (WHERE pur.purpose_key = 'for_sale'), 0),
        COALESCE(SUM(CASE WHEN pv.is_liked THEN 3 ELSE 1 END) FILTER (WHERE pur.purpose_key = 'for_rent'), 0)
    INTO v_sale_score_raw, v_rent_score_raw
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTIES p ON pv.property_id = p.property_id
    JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
    WHERE COALESCE(pv.is_disliked, FALSE) = FALSE
      AND (
          (v_user_id IS NOT NULL AND pv.user_id = v_user_id)
          OR (v_user_id IS NULL AND pv.session_id = p_session_id)
      );

    v_total_score := v_sale_score_raw + v_rent_score_raw;
    IF v_total_score > 0 THEN
        v_sale_score := (v_sale_score_raw * 100 / v_total_score);
        v_rent_score := (v_rent_score_raw * 100 / v_total_score);
    END IF;

    SELECT COALESCE(
        jsonb_object_agg((t.bedrooms)::text, t.weight),
        '{}'::jsonb
    )
    INTO v_bedrooms_counts
    FROM (
        SELECT
            pd.bedrooms,
            SUM(CASE WHEN pv.is_liked THEN 3 ELSE 1 END) AS weight
        FROM property.PROPERTY_VIEWS pv
        JOIN property.PROPERTY_DETAILS pd ON pd.property_id = pv.property_id
        WHERE COALESCE(pv.is_disliked, FALSE) = FALSE
          AND pd.bedrooms IS NOT NULL
          AND (
              (v_user_id IS NOT NULL AND pv.user_id = v_user_id)
              OR (v_user_id IS NULL AND pv.session_id = p_session_id)
          )
        GROUP BY pd.bedrooms
    ) AS t;

    SELECT COALESCE(
        jsonb_object_agg((t.bathrooms)::text, t.weight),
        '{}'::jsonb
    )
    INTO v_bathrooms_counts
    FROM (
        SELECT
            pd.bathrooms,
            SUM(CASE WHEN pv.is_liked THEN 3 ELSE 1 END) AS weight
        FROM property.PROPERTY_VIEWS pv
        JOIN property.PROPERTY_DETAILS pd ON pd.property_id = pv.property_id
        WHERE COALESCE(pv.is_disliked, FALSE) = FALSE
          AND pd.bathrooms IS NOT NULL
          AND (
              (v_user_id IS NOT NULL AND pv.user_id = v_user_id)
              OR (v_user_id IS NULL AND pv.session_id = p_session_id)
          )
        GROUP BY pd.bathrooms
    ) AS t;

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
            SUM(CASE WHEN pv.is_liked THEN 3 ELSE 1 END) AS weight
        FROM property.PROPERTY_VIEWS pv
        JOIN property.PROPERTIES p ON pv.property_id = p.property_id
        WHERE COALESCE(pv.is_disliked, FALSE) = FALSE
          AND p.price IS NOT NULL
          AND (
              (v_user_id IS NOT NULL AND pv.user_id = v_user_id)
              OR (v_user_id IS NULL AND pv.session_id = p_session_id)
          )
        GROUP BY bucket
    ) AS t;

    SELECT COALESCE(
        jsonb_object_agg((t.type_id)::text, t.weight),
        '{}'::jsonb
    )
    INTO v_property_type_counts
    FROM (
        SELECT
            ptid AS type_id,
            SUM(CASE WHEN pv.is_liked THEN 3 ELSE 1 END) AS weight
        FROM property.PROPERTY_VIEWS pv
        JOIN property.PROPERTIES p ON pv.property_id = p.property_id
        CROSS JOIN LATERAL unnest(COALESCE(p.property_type_ids, '{}')) AS ptid
        WHERE COALESCE(pv.is_disliked, FALSE) = FALSE
          AND (
              (v_user_id IS NOT NULL AND pv.user_id = v_user_id)
              OR (v_user_id IS NULL AND pv.session_id = p_session_id)
          )
        GROUP BY ptid
    ) AS t;

    SELECT COALESCE(
        jsonb_object_agg(t.feature_key, t.weight),
        '{}'::jsonb
    )
    INTO v_feature_counts
    FROM (
        SELECT
            f.feature_key,
            SUM(CASE WHEN pv.is_liked THEN 3 ELSE 1 END) AS weight
        FROM property.PROPERTY_VIEWS pv
        JOIN property.PROPERTY_DETAILS pd ON pd.property_id = pv.property_id
        CROSS JOIN LATERAL unnest(COALESCE(pd.feature_ids, '{}')) AS fid
        JOIN property.FEATURES f ON f.feature_id = fid
        WHERE COALESCE(pv.is_disliked, FALSE) = FALSE
          AND (
              (v_user_id IS NOT NULL AND pv.user_id = v_user_id)
              OR (v_user_id IS NULL AND pv.session_id = p_session_id)
          )
        GROUP BY f.feature_key
    ) AS t;

    SELECT ARRAY_AGG(DISTINCT ptid ORDER BY ptid)
    INTO v_preferred_property_type_ids
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTIES p ON p.property_id = pv.property_id
    CROSS JOIN LATERAL unnest(COALESCE(p.property_type_ids, '{}')) AS ptid
    WHERE COALESCE(pv.is_disliked, FALSE) = FALSE
      AND (
          (v_user_id IS NOT NULL AND pv.user_id = v_user_id)
          OR (v_user_id IS NULL AND pv.session_id = p_session_id)
      );

    SELECT ARRAY_AGG(DISTINCT p.location_id) FILTER (WHERE p.location_id IS NOT NULL)
    INTO v_preferred_location_ids
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTIES p ON p.property_id = pv.property_id
    WHERE COALESCE(pv.is_disliked, FALSE) = FALSE
      AND (
          (v_user_id IS NOT NULL AND pv.user_id = v_user_id)
          OR (v_user_id IS NULL AND pv.session_id = p_session_id)
      );

    SELECT ARRAY_AGG(DISTINCT p.purpose_id) FILTER (WHERE p.purpose_id IS NOT NULL)
    INTO v_preferred_purpose_ids
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTIES p ON p.property_id = pv.property_id
    WHERE COALESCE(pv.is_disliked, FALSE) = FALSE
      AND (
          (v_user_id IS NOT NULL AND pv.user_id = v_user_id)
          OR (v_user_id IS NULL AND pv.session_id = p_session_id)
      );

    SELECT ARRAY_AGG(DISTINCT fid ORDER BY fid)
    INTO v_preferred_feature_ids
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTY_DETAILS pd ON pd.property_id = pv.property_id
    CROSS JOIN LATERAL unnest(COALESCE(pd.feature_ids, '{}')) AS fid
    WHERE COALESCE(pv.is_disliked, FALSE) = FALSE
      AND (
          (v_user_id IS NOT NULL AND pv.user_id = v_user_id)
          OR (v_user_id IS NULL AND pv.session_id = p_session_id)
      );

    v_preference_counters := jsonb_build_object(
        'bedrooms', COALESCE(v_bedrooms_counts, '{}'::jsonb),
        'bathrooms', COALESCE(v_bathrooms_counts, '{}'::jsonb),
        'price_buckets', COALESCE(v_price_bucket_counts, '{}'::jsonb),
        'property_types', COALESCE(v_property_type_counts, '{}'::jsonb),
        'features', COALESCE(v_feature_counts, '{}'::jsonb)
    );

    SELECT string_agg(
        '(bedrooms:=' || key || '):' || LEAST(127, GREATEST(0, (value::numeric)::int)),
        ','
    ) INTO v_part
    FROM jsonb_each_text(COALESCE(v_bedrooms_counts, '{}'::jsonb)) AS t(key, value)
    WHERE (value::numeric)::int > 0;
    IF v_part IS NOT NULL AND v_part <> '' THEN
        v_clauses := array_append(v_clauses, v_part);
    END IF;

    SELECT string_agg(
        '(bathrooms:=' || key || '):' || LEAST(127, GREATEST(0, (value::numeric)::int)),
        ','
    ) INTO v_part
    FROM jsonb_each_text(COALESCE(v_bathrooms_counts, '{}'::jsonb)) AS t(key, value)
    WHERE (value::numeric)::int > 0;
    IF v_part IS NOT NULL AND v_part <> '' THEN
        v_clauses := array_append(v_clauses, v_part);
    END IF;

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

    SELECT string_agg(
        '(property_type_id:=' || key || '):' || LEAST(127, GREATEST(0, (value::numeric)::int)),
        ','
    ) INTO v_part
    FROM jsonb_each_text(COALESCE(v_property_type_counts, '{}'::jsonb)) AS t(key, value)
    WHERE (value::numeric)::int > 0;
    IF v_part IS NOT NULL AND v_part <> '' THEN
        v_clauses := array_append(v_clauses, v_part);
    END IF;

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

    -- Upsert prefs for this session, and for every other session of the same user
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
        s.session_id,
        v_user_id,
        v_bedrooms_min,
        v_bedrooms_max,
        v_bedrooms_avg,
        v_bathrooms_min,
        v_bathrooms_max,
        v_price_min,
        v_price_max,
        v_price_avg,
        v_preferred_property_type_ids,
        v_preferred_location_ids,
        v_preferred_purpose_ids,
        v_preferred_feature_ids,
        v_preference_counters,
        v_typesense_feed_sort_by,
        v_sale_score,
        v_rent_score,
        v_view_count,
        v_unique_count,
        v_is_ready,
        NOW() AT TIME ZONE 'UTC',
        NOW() AT TIME ZONE 'UTC'
    FROM user_activity.USER_SESSIONS s
    WHERE s.session_id = p_session_id
       OR (v_user_id IS NOT NULL AND s.user_id = v_user_id)
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
        is_ready_for_recommendations = EXCLUDED.is_ready_for_recommendations,
        last_analyzed_at = NOW() AT TIME ZONE 'UTC',
        updated_at = NOW() AT TIME ZONE 'UTC';

    -- Also sync any preference rows already tagged with this user_id
    -- whose session may no longer be linked (edge case)
    IF v_user_id IS NOT NULL THEN
        UPDATE user_activity.USER_PREFERENCES up
        SET
            preferred_bedrooms_min = v_bedrooms_min,
            preferred_bedrooms_max = v_bedrooms_max,
            preferred_bedrooms_avg = v_bedrooms_avg,
            preferred_bathrooms_min = v_bathrooms_min,
            preferred_bathrooms_max = v_bathrooms_max,
            preferred_price_min = v_price_min,
            preferred_price_max = v_price_max,
            preferred_price_avg = v_price_avg,
            preferred_property_type_ids = v_preferred_property_type_ids,
            preferred_location_ids = v_preferred_location_ids,
            preferred_purpose_ids = v_preferred_purpose_ids,
            preferred_feature_ids = v_preferred_feature_ids,
            preference_counters = v_preference_counters,
            typesense_feed_sort_by = v_typesense_feed_sort_by,
            sale_preference_score = v_sale_score,
            rent_preference_score = v_rent_score,
            total_properties_viewed = v_view_count,
            unique_properties_viewed = v_unique_count,
            is_ready_for_recommendations = v_is_ready,
            last_analyzed_at = NOW() AT TIME ZONE 'UTC',
            updated_at = NOW() AT TIME ZONE 'UTC'
        WHERE up.user_id = v_user_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Trigger: milestones / ready use user-scoped counts when logged in
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_analyze_preferences_on_property_view()
RETURNS TRIGGER AS $$
DECLARE
    v_valid_count INT;
    v_all_featured BOOLEAN;
    v_already_ready BOOLEAN;
BEGIN
    IF NEW.user_id IS NOT NULL THEN
        SELECT COUNT(*)::INT INTO v_valid_count
        FROM property.PROPERTY_VIEWS
        WHERE user_id = NEW.user_id
          AND COALESCE(is_disliked, FALSE) = FALSE;

        v_all_featured := user_activity.user_viewed_all_featured(NEW.user_id);

        SELECT COALESCE(BOOL_OR(is_ready_for_recommendations), FALSE)
        INTO v_already_ready
        FROM user_activity.USER_PREFERENCES
        WHERE user_id = NEW.user_id;
    ELSE
        SELECT COUNT(*)::INT INTO v_valid_count
        FROM property.PROPERTY_VIEWS
        WHERE session_id = NEW.session_id
          AND COALESCE(is_disliked, FALSE) = FALSE;

        v_all_featured := user_activity.session_viewed_all_featured(NEW.session_id);

        SELECT COALESCE(is_ready_for_recommendations, FALSE)
        INTO v_already_ready
        FROM user_activity.USER_PREFERENCES
        WHERE session_id = NEW.session_id;
    END IF;

    IF v_valid_count >= 5 AND v_valid_count % 5 = 0 THEN
        PERFORM analyze_user_preferences(NEW.session_id);
    ELSIF v_all_featured AND NOT COALESCE(v_already_ready, FALSE) THEN
        PERFORM analyze_user_preferences(NEW.session_id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_analyze_preferences_on_property_view ON property.PROPERTY_VIEWS;
CREATE TRIGGER trg_analyze_preferences_on_property_view
    AFTER INSERT ON property.PROPERTY_VIEWS
    FOR EACH ROW
    EXECUTE FUNCTION trigger_analyze_preferences_on_property_view();

-- =============================================================================
-- OPTIONAL checks after deploy
-- SELECT analyze_user_preferences('YOUR_SESSION_ID');
-- Then verify both sessions for the same user_id share ready / sort / counters.
-- =============================================================================
