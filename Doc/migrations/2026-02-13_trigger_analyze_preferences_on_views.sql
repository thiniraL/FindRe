-- Trigger: after a property view is inserted, if session valid view count is 5, 10, 15, …
-- run analyze_user_preferences so USER_PREFERENCES is kept up to date (Supabase/DB side).
-- Valid views = exclude disliked (same logic as analyze_user_preferences).

CREATE OR REPLACE FUNCTION trigger_analyze_preferences_on_property_view()
RETURNS TRIGGER AS $$
DECLARE
    v_valid_count INT;
BEGIN
    SELECT COUNT(*)::INT INTO v_valid_count
    FROM property.PROPERTY_VIEWS
    WHERE session_id = NEW.session_id
      AND COALESCE(is_disliked, FALSE) = FALSE;

    IF v_valid_count >= 5 AND v_valid_count % 5 = 0 THEN
        PERFORM analyze_user_preferences(NEW.session_id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_analyze_preferences_on_property_view
    AFTER INSERT ON property.PROPERTY_VIEWS
    FOR EACH ROW
    EXECUTE FUNCTION trigger_analyze_preferences_on_property_view();
