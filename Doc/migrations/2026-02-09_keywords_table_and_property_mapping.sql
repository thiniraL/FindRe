-- Migration: KEYWORDS table + PROPERTY_KEYWORDS mapping for filter config
-- Date: 2026-02-09
-- Keywords are stored here; filter config options come from this table. Properties linked via PROPERTY_KEYWORDS.
-- Search body unchanged: still passes "keyword" (string). Config options use value = keyword_text.

BEGIN;

-- ============================================
-- KEYWORDS table
-- ============================================
CREATE TABLE IF NOT EXISTS property.KEYWORDS (
    keyword_id SERIAL PRIMARY KEY,
    keyword_key VARCHAR(100) NOT NULL UNIQUE,
    display_label VARCHAR(200),
    display_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
);

COMMENT ON TABLE property.KEYWORDS IS 'Predefined keywords for filter config; options shown in keyword filter come from here.';

-- ============================================
-- PROPERTY_KEYWORDS mapping (property <-> keywords)
-- ============================================
CREATE TABLE IF NOT EXISTS property.PROPERTY_KEYWORDS (
    property_id INT NOT NULL,
    keyword_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    PRIMARY KEY (property_id, keyword_id),
    FOREIGN KEY (property_id) REFERENCES property.PROPERTIES(property_id) ON DELETE CASCADE,
    FOREIGN KEY (keyword_id) REFERENCES property.KEYWORDS(keyword_id) ON DELETE CASCADE
);

COMMENT ON TABLE property.PROPERTY_KEYWORDS IS 'Links properties to keywords; used for filter options scope and future keyword-based filtering.';

CREATE INDEX IF NOT EXISTS idx_property_keywords_property ON property.PROPERTY_KEYWORDS(property_id);
CREATE INDEX IF NOT EXISTS idx_property_keywords_keyword ON property.PROPERTY_KEYWORDS(keyword_id);

-- Optional: seed a few keywords (filter config will show options from table)
INSERT INTO property.KEYWORDS (keyword_key, display_label, display_order) VALUES
    ('beach', 'Beach', 1),
    ('golf', 'Golf', 2),
    ('marina', 'Marina', 3),
    ('waterfront', 'Waterfront', 4),
    ('luxury', 'Luxury', 5)
ON CONFLICT (keyword_key) DO NOTHING;

COMMIT;
