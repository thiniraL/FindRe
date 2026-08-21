-- =============================================================================
-- Ready flag: count like OR dislike (any PROPERTY_VIEWS row) on featured
-- =============================================================================
-- Re-run safely (CREATE OR REPLACE). Prefer applying full
-- 2026-08-21_sync_preferences_across_user_sessions.sql if not applied yet;
-- this file is enough if that migration was already applied with the old
-- "non-disliked only" ready rule.
-- =============================================================================

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
