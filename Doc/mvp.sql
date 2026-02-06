-- Bayut Property Database Schema (PostgreSQL Version - MVP)
-- MVP Level: Removed PROPERTY_TRANSACTIONS, TRU_ESTIMATE, PROJECTS, DEVELOPERS
-- Simplified design: Unified AGENTS (Brokers + Agents)
-- Multi-Currency, Multi-Country, Multi-Language Support with UTC Timestamps
-- Authentication & Authorization with Anonymous User Support
-- 
-- TRANSLATION APPROACH: JSONB columns for fast queries (no JOINs needed!)
-- All translations stored as JSONB: {"en": "English text", "ar": "Arabic text", ...}
-- This provides 10-30ms query times vs 200-500ms with separate translation tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- CREATE SCHEMAS
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS login;      -- Authentication & Authorization
CREATE SCHEMA IF NOT EXISTS master;     -- Master/Reference Data (Languages, Countries, Currencies)
CREATE SCHEMA IF NOT EXISTS property;   -- Property Domain (Properties, Types, Locations, etc.)
CREATE SCHEMA IF NOT EXISTS business;   -- Business Entities (Agencies, Agents, Companies, Features)
CREATE SCHEMA IF NOT EXISTS user_activity;  -- User Activity & Preferences

-- ============================================================================
-- MULTI-LANGUAGE, MULTI-CURRENCY, MULTI-COUNTRY MASTER TABLES (Core First)
-- These are in the property schema as they're shared by property domain
-- ============================================================================

-- ============================================
-- TABLE: LANGUAGES (Master Table)
-- ============================================
CREATE TABLE master.LANGUAGES (
    language_id SERIAL PRIMARY KEY,
    language_code VARCHAR(5) NOT NULL UNIQUE, -- ISO 639-1 (e.g., 'en', 'ar', 'fr')
    language_name VARCHAR(100) NOT NULL,
    language_code_3 VARCHAR(3), -- ISO 639-2 (e.g., 'eng', 'ara', 'fra')
    is_default BOOLEAN DEFAULT FALSE, -- One language should be default
    is_active BOOLEAN DEFAULT TRUE,
    is_rtl BOOLEAN DEFAULT FALSE, -- Right-to-left languages (Arabic, Hebrew)
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    CONSTRAINT chk_language_code_length CHECK (LENGTH(TRIM(language_code)) >= 2)
);

-- ============================================================================
-- AUTHENTICATION & AUTHORIZATION TABLES (in login schema)
-- ============================================================================

-- Users table
CREATE TABLE IF NOT EXISTS login.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE NOT NULL,
    email_verification_token VARCHAR(255) NULL,
    password_reset_token VARCHAR(255) NULL,
    password_reset_expires TIMESTAMP NULL,
    two_factor_secret VARCHAR(255) NULL,
    two_factor_enabled BOOLEAN DEFAULT FALSE NOT NULL,
    last_login TIMESTAMP NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    preferred_language_code VARCHAR(5) DEFAULT 'en',
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC') NOT NULL,
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC') NOT NULL
);

-- Foreign key constraint for users preferred_language_code
ALTER TABLE login.users
ADD CONSTRAINT fk_users_preferred_language 
FOREIGN KEY (preferred_language_code) 
REFERENCES master.LANGUAGES(language_code) 
ON DELETE SET NULL;

-- Indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_email ON login.users(email);
CREATE INDEX IF NOT EXISTS idx_users_email_verification_token ON login.users(email_verification_token);
CREATE INDEX IF NOT EXISTS idx_users_password_reset_token ON login.users(password_reset_token);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON login.users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_preferred_language ON login.users(preferred_language_code);

-- Roles table
CREATE TABLE IF NOT EXISTS login.roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NULL,
    is_system BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC') NOT NULL,
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC') NOT NULL
);

-- Indexes for roles table
CREATE INDEX IF NOT EXISTS idx_roles_name ON login.roles(name);
CREATE INDEX IF NOT EXISTS idx_roles_is_system ON login.roles(is_system);

-- Permissions table
CREATE TABLE IF NOT EXISTS login.permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    description TEXT NULL,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC') NOT NULL,
    CONSTRAINT unique_resource_action UNIQUE (resource, action)
);

-- Indexes for permissions table
CREATE INDEX IF NOT EXISTS idx_permissions_resource ON login.permissions(resource);
CREATE INDEX IF NOT EXISTS idx_permissions_action ON login.permissions(action);

-- Role-Permissions junction table (many-to-many)
CREATE TABLE IF NOT EXISTS login.role_permissions (
    role_id UUID NOT NULL REFERENCES login.roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES login.permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC') NOT NULL,
    CONSTRAINT pk_role_permissions PRIMARY KEY (role_id, permission_id)
);

-- Indexes for role_permissions table
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON login.role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON login.role_permissions(permission_id);

-- User-Roles table (single role per user)
CREATE TABLE IF NOT EXISTS login.user_roles (
    user_id UUID NOT NULL PRIMARY KEY REFERENCES login.users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES login.roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC') NOT NULL,
    assigned_by UUID NULL REFERENCES login.users(id) ON DELETE SET NULL,
    CONSTRAINT unique_user_role UNIQUE (user_id)
);

-- Indexes for user_roles table
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON login.user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_assigned_by ON login.user_roles(assigned_by);

-- User-Permissions junction table (direct permissions granted to users)
CREATE TABLE IF NOT EXISTS login.user_permissions (
    user_id UUID NOT NULL REFERENCES login.users(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES login.permissions(id) ON DELETE CASCADE,
    granted_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC') NOT NULL,
    granted_by UUID NULL REFERENCES login.users(id) ON DELETE SET NULL,
    CONSTRAINT pk_user_permissions PRIMARY KEY (user_id, permission_id)
);

-- Indexes for user_permissions table
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON login.user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_permission_id ON login.user_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_granted_by ON login.user_permissions(granted_by);

-- User-Identities table (external auth providers)
CREATE TABLE IF NOT EXISTS login.user_identities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES login.users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    email VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC') NOT NULL,
    CONSTRAINT unique_provider_user UNIQUE (provider, provider_user_id)
);

-- Indexes for user_identities table
CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON login.user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_provider ON login.user_identities(provider);

-- Refresh tokens table
CREATE TABLE IF NOT EXISTS login.refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES login.users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    device_id VARCHAR(255) NULL,
    ip_address INET NULL,
    user_agent TEXT NULL,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC') NOT NULL
);

-- Indexes for refresh_tokens table
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON login.refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON login.refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON login.refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_revoked_at ON login.refresh_tokens(revoked_at);

-- Sessions table (for authenticated sessions)
CREATE TABLE IF NOT EXISTS login.sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES login.users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC') NOT NULL
);

-- Indexes for sessions table
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON login.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session_token ON login.sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON login.sessions(expires_at);

-- ============================================================================
-- USER SESSION TRACKING (Supports Both Authenticated & Anonymous Users)
-- This is in property schema as it's used by property views
-- ============================================================================

-- USER_SESSIONS table (Enhanced for tracking both logged-in and anonymous users)
CREATE TABLE user_activity.USER_SESSIONS (
    session_id VARCHAR(100) PRIMARY KEY, -- Client-generated session ID (cookie-based)
    user_id UUID NULL, -- NULL for anonymous users, set when logged in
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    country_code VARCHAR(2),
    language_code VARCHAR(5),
    preferred_language_code VARCHAR(5) DEFAULT 'en',
    first_seen_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    last_activity_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    total_views INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    FOREIGN KEY (user_id) REFERENCES login.users(id) ON DELETE SET NULL,
    FOREIGN KEY (preferred_language_code) REFERENCES master.LANGUAGES(language_code) ON DELETE SET NULL,
    
    CONSTRAINT chk_session_id_length CHECK (LENGTH(TRIM(session_id)) > 0),
    CONSTRAINT chk_total_views CHECK (total_views >= 0)
);

-- Indexes for USER_SESSIONS
CREATE INDEX idx_user_sessions_user_id ON user_activity.USER_SESSIONS(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_user_sessions_active ON user_activity.USER_SESSIONS(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_user_sessions_last_activity ON user_activity.USER_SESSIONS(last_activity_at DESC);
CREATE INDEX idx_user_sessions_preferred_language ON user_activity.USER_SESSIONS(preferred_language_code);

-- ============================================
-- TABLE: COUNTRIES (Master Table with JSONB Translations)
-- ============================================
CREATE TABLE master.COUNTRIES (
    country_id SERIAL PRIMARY KEY,
    country_code VARCHAR(2) NOT NULL UNIQUE, -- ISO 3166-1 alpha-2 (e.g., 'AE', 'US', 'GB')
    country_code_3 VARCHAR(3), -- ISO 3166-1 alpha-3 (e.g., 'ARE', 'USA', 'GBR')
    -- Translations: {"en": "United Arab Emirates", "ar": "الإمارات العربية المتحدة"}
    name_translations JSONB NOT NULL,
    timezone VARCHAR(50), -- Primary timezone (e.g., 'Asia/Dubai', 'America/New_York')
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    CONSTRAINT chk_country_translations CHECK (
        name_translations ? 'en' AND -- Must have English
        jsonb_typeof(name_translations) = 'object'
    )
);

-- ============================================
-- TABLE: CURRENCIES (Master Table with JSONB Translations)
-- ============================================
CREATE TABLE master.CURRENCIES (
    currency_id SERIAL PRIMARY KEY,
    currency_code VARCHAR(3) NOT NULL UNIQUE, -- ISO 4217 (e.g., 'AED', 'USD', 'EUR')
    -- Translations: {"en": "United Arab Emirates Dirham", "ar": "درهم إماراتي"}
    name_translations JSONB NOT NULL,
    currency_symbol VARCHAR(10), -- e.g., 'د.إ', '$', '€'
    decimal_places INT DEFAULT 2,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    CONSTRAINT chk_currency_code_length CHECK (LENGTH(TRIM(currency_code)) = 3),
    CONSTRAINT chk_decimal_places CHECK (decimal_places >= 0 AND decimal_places <= 4),
    CONSTRAINT chk_currency_translations CHECK (
        name_translations ? 'en' AND -- Must have English
        jsonb_typeof(name_translations) = 'object'
    )
);

-- ============================================================================
-- PROPERTY DOMAIN TABLES
-- ============================================================================

-- ============================================
-- TABLE: PROPERTY_TYPES (With JSONB Translations)
-- ============================================
CREATE TABLE property.PROPERTY_TYPES (
    type_id SERIAL PRIMARY KEY,
    type_key VARCHAR(50) NOT NULL UNIQUE, -- Internal key (e.g., 'villa', 'apartment')
    -- Translations: {"en": "Villa", "ar": "فيلا", "fr": "Villa"}
    name_translations JSONB NOT NULL,
    -- Descriptions: {"en": "Standalone residential property", "ar": "ممتلكات سكنية قائمة بذاتها"}
    description_translations JSONB,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    CONSTRAINT chk_property_type_translations CHECK (
        name_translations ? 'en' AND -- Must have English
        jsonb_typeof(name_translations) = 'object'
    )
);

-- ============================================
-- TABLE: PURPOSES (With JSONB Translations)
-- ============================================
CREATE TABLE property.PURPOSES (
    purpose_id SERIAL PRIMARY KEY,
    purpose_key VARCHAR(50) NOT NULL UNIQUE, -- Internal key (e.g., 'for_sale', 'for_rent')
    -- Translations: {"en": "For Sale", "ar": "للبيع"}
    name_translations JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    CONSTRAINT chk_purpose_translations CHECK (
        name_translations ? 'en' AND -- Must have English
        jsonb_typeof(name_translations) = 'object'
    )
);

-- ============================================
-- TABLE: LOCATIONS (With JSONB Translations)
-- ============================================
CREATE TABLE property.LOCATIONS (
    location_id SERIAL PRIMARY KEY,
    country_id INT NOT NULL, -- REQUIRED - every location belongs to a country
    emirate VARCHAR(100), -- UAE Emirate (Dubai, Abu Dhabi, Ras Al Khaimah, etc.) - NULL for non-UAE
    state_province VARCHAR(100), -- Generic state/province field for other countries
    -- Translations: {"en": {"city": "Dubai", "area": "Arabian Ranches", "community": "Polo Home"}, "ar": {...}}
    translations JSONB NOT NULL,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    postal_code VARCHAR(20),
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    FOREIGN KEY (country_id) REFERENCES master.COUNTRIES(country_id) ON DELETE RESTRICT,
    
    CONSTRAINT chk_latitude_range CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
    CONSTRAINT chk_longitude_range CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
    CONSTRAINT chk_location_translations CHECK (
        translations ? 'en' AND -- Must have English
        jsonb_typeof(translations) = 'object'
    )
);

-- ============================================
-- TABLE: AGENCIES (With JSONB Translations)
-- ============================================
CREATE TABLE business.AGENCIES (
    agency_id SERIAL PRIMARY KEY,
    agency_key VARCHAR(200) NOT NULL UNIQUE, -- Internal key
    license_number VARCHAR(100),
    address TEXT,
    country_id INT, -- Country where agency is located
    emirate VARCHAR(100), -- UAE-specific, NULL for other countries
    state_province VARCHAR(100), -- Generic state/province for other countries
    phone VARCHAR(20),
    email VARCHAR(255),
    website VARCHAR(500),
    logo_url VARCHAR(500),
    -- Translations: {"en": {"name": "Metropolitan Premium Properties", "city": "Dubai", "description": "..."}, "ar": {...}}
    translations JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    FOREIGN KEY (country_id) REFERENCES master.COUNTRIES(country_id) ON DELETE SET NULL,
    
    CONSTRAINT chk_email_format CHECK (email IS NULL OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT chk_agency_translations CHECK (
        translations ? 'en' AND -- Must have English
        jsonb_typeof(translations) = 'object'
    )
);

-- ============================================
-- TABLE: AGENTS (Unified - Brokers + Agents)
-- Brokers have agency_id set, Agents have agency_id NULL
-- ============================================
CREATE TABLE business.AGENTS (
    agent_id SERIAL PRIMARY KEY,
    agent_name VARCHAR(200) NOT NULL,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20),
    whatsapp VARCHAR(20),
    license_number VARCHAR(100),
    profile_image_url VARCHAR(500),
    company_name VARCHAR(200),
    profile_slug VARCHAR(300) UNIQUE,
    is_trubroker BOOLEAN DEFAULT FALSE,
    total_properties INT DEFAULT 0,
    average_rating DECIMAL(3,2),
    total_reviews INT DEFAULT 0,
    bio TEXT,
    languages VARCHAR(500),
    specialties TEXT,
    years_of_experience INT,
    agency_id INT, -- NULL for agents, set for brokers
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    FOREIGN KEY (agency_id) REFERENCES business.AGENCIES(agency_id) ON DELETE SET NULL,
    
    CONSTRAINT chk_agent_name_length CHECK (LENGTH(TRIM(agent_name)) > 0),
    CONSTRAINT chk_agent_email_format CHECK (email IS NULL OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT chk_agent_total_properties CHECK (total_properties >= 0),
    CONSTRAINT chk_agent_average_rating CHECK (average_rating IS NULL OR (average_rating >= 0.00 AND average_rating <= 5.00)),
    CONSTRAINT chk_agent_total_reviews CHECK (total_reviews >= 0),
    CONSTRAINT chk_agent_years_experience CHECK (years_of_experience IS NULL OR years_of_experience >= 0),
    CONSTRAINT chk_agent_has_contact CHECK (email IS NOT NULL OR phone IS NOT NULL OR whatsapp IS NOT NULL)
);

-- ============================================
-- TABLE: COMPANIES (With JSONB Translations)
-- Companies can own properties
-- ============================================
CREATE TABLE business.COMPANIES (
    company_id SERIAL PRIMARY KEY,
    company_type VARCHAR(20) NOT NULL, -- 'Company' or 'Individual'
    company_key VARCHAR(200) NOT NULL UNIQUE, -- Internal key
    email VARCHAR(255),
    phone VARCHAR(20),
    website VARCHAR(500),
    logo_url VARCHAR(500),
    address TEXT,
    country_id INT, -- Country where company is registered/operates
    registration_number VARCHAR(100),
    established_year INT,
    total_properties INT DEFAULT 0,
    -- Translations: {"en": {"name": "RAK Properties", "bio": "...", "description": "..."}, "ar": {...}}
    translations JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    FOREIGN KEY (country_id) REFERENCES master.COUNTRIES(country_id) ON DELETE SET NULL,
    
    CONSTRAINT chk_company_type CHECK (company_type IN ('Company', 'Individual')),
    CONSTRAINT chk_company_translations CHECK (
        translations ? 'en' AND -- Must have English
        jsonb_typeof(translations) = 'object'
    )
);

-- ============================================
-- TABLE: PROPERTIES (With JSONB Translations)
-- ============================================
CREATE TABLE property.PROPERTIES (
    property_id SERIAL PRIMARY KEY,
    -- Translations: {"en": {"title": "...", "description": "..."}, "ar": {...}}
    title_translations JSONB NOT NULL,
    description_translations JSONB,
    
    property_type_id INT NOT NULL,
    purpose_id INT NOT NULL,
    location_id INT NOT NULL,

    -- Denormalized human-readable address (optional)
    address TEXT,
    
    -- Company (who owns this property)
    company_id INT NOT NULL, -- REQUIRED - every property has a company owner
    
    -- Agent who listed it
    agent_id INT NOT NULL, -- Listed by agent/broker (broker if agency_id is set, agent if NULL)
    
    currency_id INT NOT NULL, -- REQUIRED - references CURRENCIES table
    reference_number VARCHAR(100) UNIQUE,
    status VARCHAR(20) DEFAULT 'Active',
    price DECIMAL(15,2),
    price_min DECIMAL(15,2),
    price_max DECIMAL(15,2),
    completion_status VARCHAR(50),
    furnishing_status VARCHAR(50),
    trucheck_date DATE,
    average_rent DECIMAL(15,2),
    is_off_plan BOOLEAN DEFAULT FALSE,

    -- Featured (now stored directly on PROPERTIES; replaces FEATURED_PROPERTIES table)
    is_featured BOOLEAN DEFAULT FALSE,
    featured_rank INT,

    added_date TIMESTAMP,
    reactivated_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    FOREIGN KEY (property_type_id) REFERENCES property.PROPERTY_TYPES(type_id),
    FOREIGN KEY (purpose_id) REFERENCES property.PURPOSES(purpose_id),
    FOREIGN KEY (location_id) REFERENCES property.LOCATIONS(location_id),
    FOREIGN KEY (company_id) REFERENCES business.COMPANIES(company_id) ON DELETE RESTRICT,
    FOREIGN KEY (agent_id) REFERENCES business.AGENTS(agent_id) ON DELETE SET NULL,
    FOREIGN KEY (currency_id) REFERENCES master.CURRENCIES(currency_id) ON DELETE RESTRICT,
    
    CONSTRAINT chk_property_title_translations CHECK (
        title_translations ? 'en' AND -- Must have English
        jsonb_typeof(title_translations) = 'object'
    ),
    CONSTRAINT chk_featured_rank_nonnegative CHECK (featured_rank IS NULL OR featured_rank >= 0),
    CONSTRAINT chk_featured_requires_rank CHECK (is_featured = FALSE OR featured_rank IS NOT NULL)
    )
);

-- ============================================
-- TABLE: PROPERTY_DETAILS
-- ============================================
CREATE TABLE property.PROPERTY_DETAILS (
    detail_id SERIAL PRIMARY KEY,
    property_id INT NOT NULL UNIQUE,
    bedrooms INT,
    bathrooms INT,
    area_sqft DECIMAL(10,2),
    area_sqm DECIMAL(10,2),

    -- Feature keys for this property (stored here, not in PROPERTIES)
    -- Example: ['air_conditioning','pool']
    features JSONB DEFAULT '[]'::JSONB,

    parking_spaces INT,
    year_built INT,
    floor_number INT,
    total_floors INT,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),

    FOREIGN KEY (property_id) REFERENCES property.PROPERTIES(property_id) ON DELETE CASCADE
);

-- ============================================
-- TABLE: FEATURES (With JSONB Translations)
-- ============================================
CREATE TABLE property.FEATURES (
    feature_id SERIAL PRIMARY KEY,
    feature_key VARCHAR(100) NOT NULL UNIQUE, -- Internal key (e.g., 'swimming_pool', 'garden')
    feature_type VARCHAR(50), -- 'Amenity', 'Feature', 'Utility', etc.
    icon_url VARCHAR(500),
    display_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    -- Translations: {"en": "Swimming Pool", "ar": "مسبح"}
    name_translations JSONB NOT NULL,
    -- Descriptions: {"en": "...", "ar": "..."}
    description_translations JSONB,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    CONSTRAINT chk_feature_translations CHECK (
        name_translations ? 'en' AND -- Must have English
        jsonb_typeof(name_translations) = 'object'
    )
);

-- ============================================
-- TABLE: PROPERTY_FEATURES
-- ============================================
CREATE TABLE property.PROPERTY_FEATURES (
    property_feature_id SERIAL PRIMARY KEY,
    property_id INT NOT NULL,
    feature_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    FOREIGN KEY (property_id) REFERENCES property.PROPERTIES(property_id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES property.FEATURES(feature_id) ON DELETE CASCADE,
    CONSTRAINT uq_property_feature UNIQUE (property_id, feature_id)
);

-- ============================================
-- TABLE: PROPERTY_IMAGES
-- ============================================
CREATE TABLE property.PROPERTY_IMAGES (
    image_id SERIAL PRIMARY KEY,
    property_id INT NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    image_type VARCHAR(50),
    display_order INT DEFAULT 0,
    is_primary BOOLEAN DEFAULT FALSE,
    alt_text VARCHAR(200),
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),

    FOREIGN KEY (property_id) REFERENCES property.PROPERTIES(property_id) ON DELETE CASCADE
);

-- ============================================
-- TABLE: AGENT_RATINGS (Unified - for both brokers and agents)
-- ============================================
CREATE TABLE business.AGENT_RATINGS (
    rating_id SERIAL PRIMARY KEY,
    agent_id INT NOT NULL,
    reviewer_name VARCHAR(200),
    reviewer_email VARCHAR(255),
    rating INT NOT NULL,
    review_text TEXT,
    review_date DATE,
    is_verified BOOLEAN DEFAULT FALSE,
    helpful_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    FOREIGN KEY (agent_id) REFERENCES business.AGENTS(agent_id) ON DELETE CASCADE,
    
    CONSTRAINT chk_agent_rating_range CHECK (rating >= 1 AND rating <= 5),
    CONSTRAINT chk_agent_reviewer_email_format CHECK (reviewer_email IS NULL OR reviewer_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT chk_agent_helpful_count CHECK (helpful_count >= 0)
);

-- ============================================
-- TABLE: PROPERTY_VIEWS (Enhanced - Supports Both Users & Anonymous)
-- ============================================
CREATE TABLE property.PROPERTY_VIEWS (
    view_id BIGSERIAL PRIMARY KEY,
    property_id INT NOT NULL,
    session_id VARCHAR(100) NOT NULL, -- Always required (anonymous or logged-in)
    user_id UUID NULL, -- NULL for anonymous, set when logged in
    viewed_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    view_duration_seconds INT, -- How long they viewed (if tracked)
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    is_liked BOOLEAN DEFAULT FALSE,
    is_disliked BOOLEAN DEFAULT FALSE,
    feedback_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    FOREIGN KEY (property_id) REFERENCES property.PROPERTIES(property_id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES user_activity.USER_SESSIONS(session_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES login.users(id) ON DELETE SET NULL,
    
    CONSTRAINT chk_view_duration CHECK (view_duration_seconds IS NULL OR view_duration_seconds >= 0)
);

-- ============================================
-- TABLE: SEARCH_FILTER_CONFIGS (UI filter configuration, versioned)
-- Lets the app render filters dynamically per purpose and optional scope.
-- ============================================
CREATE TABLE master.SEARCH_FILTER_CONFIGS (
    config_id BIGSERIAL PRIMARY KEY,
    purpose_key VARCHAR(50) NOT NULL, -- references PURPOSES.purpose_key
    country_id INT NULL,
    currency_id INT NULL,
    language_code VARCHAR(5) NULL,
    version INT NOT NULL DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    config_json JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),

    FOREIGN KEY (purpose_key) REFERENCES property.PURPOSES(purpose_key) ON DELETE RESTRICT,
    FOREIGN KEY (country_id) REFERENCES master.COUNTRIES(country_id) ON DELETE SET NULL,
    FOREIGN KEY (currency_id) REFERENCES master.CURRENCIES(currency_id) ON DELETE SET NULL,
    FOREIGN KEY (language_code) REFERENCES master.LANGUAGES(language_code) ON DELETE SET NULL,

    CONSTRAINT chk_search_filter_version CHECK (version >= 1),
    CONSTRAINT chk_search_filter_config_json CHECK (jsonb_typeof(config_json) = 'object'),
    CONSTRAINT uq_search_filter_config_scope_version UNIQUE (purpose_key, country_id, currency_id, language_code, version)
);

-- ============================================
-- TABLE: USER_PREFERENCES (Computed from views)
-- Supports both authenticated and anonymous users
-- ============================================
CREATE TABLE user_activity.USER_PREFERENCES (
    preference_id SERIAL PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL, -- Always required
    user_id UUID NULL, -- NULL for anonymous, set when logged in
    
    -- Analyzed preferences (computed from views)
    preferred_bedrooms_min INT,
    preferred_bedrooms_max INT,
    preferred_bedrooms_avg DECIMAL(5,2),
    preferred_bathrooms_min INT,
    preferred_bathrooms_max INT,
    preferred_price_min DECIMAL(15,2),
    preferred_price_max DECIMAL(15,2),
    preferred_price_avg DECIMAL(15,2),
    preferred_property_type_ids INT[], -- Array of preferred type IDs
    preferred_location_ids INT[], -- Array of preferred location IDs
    preferred_purpose_ids INT[], -- Sale vs Rent preference
    preferred_feature_ids INT[], -- Features they like (pool, garden, etc.)
    -- JSONB tallies for fine-grained preference scoring (per-session)
    -- Example structure:
    -- {
    --   "bedrooms": { "1": 2, "2": 5 },
    --   "bathrooms": { "1": 1, "2": 4 },
    --   "price_buckets": { "0-1000000": 3, "1000000-2000000": 2 },
    --   "property_types": { "1": 4, "2": 1 },
    --   "features": { "swimming_pool": 3, "garden": 1 }
    -- }
    preference_counters JSONB,
    
    -- Preference scores (0-100, higher = stronger preference)
    sale_preference_score INT DEFAULT 50, -- 0-100, 50 = neutral
    rent_preference_score INT DEFAULT 50,
    
    -- View statistics
    total_properties_viewed INT DEFAULT 0,
    unique_properties_viewed INT DEFAULT 0,
    last_analyzed_at TIMESTAMP,
    is_ready_for_recommendations BOOLEAN DEFAULT FALSE, -- TRUE when >= 5 views
    
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    
    FOREIGN KEY (session_id) REFERENCES user_activity.USER_SESSIONS(session_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES login.users(id) ON DELETE SET NULL,
    
    CONSTRAINT chk_preference_scores CHECK (
        sale_preference_score >= 0 AND sale_preference_score <= 100 AND
        rent_preference_score >= 0 AND rent_preference_score <= 100
    ),
    CONSTRAINT chk_min_views CHECK (total_properties_viewed >= 0),
    CONSTRAINT uq_session_preferences UNIQUE (session_id)
);



-- ============================================================================
-- INDEXES
-- ============================================================================

-- LANGUAGES
CREATE INDEX idx_language_code ON master.LANGUAGES(language_code);
CREATE INDEX idx_language_default ON master.LANGUAGES(is_default) WHERE is_default = TRUE;
CREATE INDEX idx_language_active ON master.LANGUAGES(is_active) WHERE is_default = TRUE;

-- COUNTRIES
CREATE INDEX idx_country_code ON master.COUNTRIES(country_code);
CREATE INDEX idx_country_active ON master.COUNTRIES(is_active);
-- JSONB indexes for country name translations
CREATE INDEX idx_country_name_en ON master.COUNTRIES USING BTREE ((name_translations->>'en'));
CREATE INDEX idx_country_name_ar ON master.COUNTRIES USING BTREE ((name_translations->>'ar'));
CREATE INDEX idx_country_translations_gin ON master.COUNTRIES USING GIN (name_translations);

-- CURRENCIES
CREATE INDEX idx_currency_code ON master.CURRENCIES(currency_code);
CREATE INDEX idx_currency_active ON master.CURRENCIES(is_active);
-- JSONB indexes for currency name translations
CREATE INDEX idx_currency_name_en ON master.CURRENCIES USING BTREE ((name_translations->>'en'));
CREATE INDEX idx_currency_translations_gin ON master.CURRENCIES USING GIN (name_translations);

-- PROPERTY_TYPES
CREATE INDEX idx_type_key ON property.PROPERTY_TYPES(type_key);
-- JSONB indexes for property type translations
CREATE INDEX idx_property_type_name_en ON property.PROPERTY_TYPES USING BTREE ((name_translations->>'en'));
CREATE INDEX idx_property_type_name_ar ON property.PROPERTY_TYPES USING BTREE ((name_translations->>'ar'));
CREATE INDEX idx_property_type_translations_gin ON property.PROPERTY_TYPES USING GIN (name_translations);
CREATE INDEX idx_property_type_search_en ON property.PROPERTY_TYPES 
    USING GIN (to_tsvector('english', name_translations->>'en'));

-- PURPOSES
CREATE INDEX idx_purpose_key ON property.PURPOSES(purpose_key);
-- JSONB indexes for purpose translations
CREATE INDEX idx_purpose_name_en ON property.PURPOSES USING BTREE ((name_translations->>'en'));
CREATE INDEX idx_purpose_name_ar ON property.PURPOSES USING BTREE ((name_translations->>'ar'));
CREATE INDEX idx_purpose_translations_gin ON property.PURPOSES USING GIN (name_translations);

-- LOCATIONS
CREATE INDEX idx_location_country ON property.LOCATIONS(country_id);
CREATE INDEX idx_emirate ON property.LOCATIONS(emirate);
CREATE INDEX idx_state_province ON property.LOCATIONS(state_province);
-- JSONB indexes for location translations
CREATE INDEX idx_location_city_en ON property.LOCATIONS USING BTREE ((translations->'en'->>'city'));
CREATE INDEX idx_location_area_en ON property.LOCATIONS USING BTREE ((translations->'en'->>'area'));
CREATE INDEX idx_location_community_en ON property.LOCATIONS USING BTREE ((translations->'en'->>'community'));
CREATE INDEX idx_location_city_ar ON property.LOCATIONS USING BTREE ((translations->'ar'->>'city'));
CREATE INDEX idx_location_translations_gin ON property.LOCATIONS USING GIN (translations);
CREATE INDEX idx_location_search_en ON property.LOCATIONS 
    USING GIN (to_tsvector('english', 
        COALESCE(translations->'en'->>'city', '') || ' ' || 
        COALESCE(translations->'en'->>'area', '') || ' ' || 
        COALESCE(translations->'en'->>'community', '')
    ));

-- AGENCIES
CREATE INDEX idx_agency_key ON business.AGENCIES(agency_key);
CREATE INDEX idx_agency_country ON business.AGENCIES(country_id);
CREATE INDEX idx_agency_emirate ON business.AGENCIES(emirate);
-- JSONB indexes for agency translations
CREATE INDEX idx_agency_name_en ON business.AGENCIES USING BTREE ((translations->'en'->>'name'));
CREATE INDEX idx_agency_name_ar ON business.AGENCIES USING BTREE ((translations->'ar'->>'name'));
CREATE INDEX idx_agency_translations_gin ON business.AGENCIES USING GIN (translations);
CREATE INDEX idx_agency_search_en ON business.AGENCIES 
    USING GIN (to_tsvector('english', translations->'en'->>'name'));

-- AGENTS (Unified - Brokers + Agents)
CREATE INDEX idx_agent_name ON business.AGENTS(agent_name);
CREATE INDEX idx_agent_email ON business.AGENTS(email);
CREATE INDEX idx_agent_phone ON business.AGENTS(phone);
CREATE INDEX idx_agent_agency ON business.AGENTS(agency_id);
CREATE INDEX idx_agent_slug ON business.AGENTS(profile_slug);
CREATE INDEX idx_agent_trubroker ON business.AGENTS(is_trubroker);
CREATE INDEX idx_agent_rating ON business.AGENTS(average_rating);

-- COMPANIES
CREATE INDEX idx_company_key ON business.COMPANIES(company_key);
CREATE INDEX idx_company_type ON business.COMPANIES(company_type);
CREATE INDEX idx_company_country ON business.COMPANIES(country_id);
-- JSONB indexes for company translations
CREATE INDEX idx_company_name_en ON business.COMPANIES USING BTREE ((translations->'en'->>'name'));
CREATE INDEX idx_company_name_ar ON business.COMPANIES USING BTREE ((translations->'ar'->>'name'));
CREATE INDEX idx_company_translations_gin ON business.COMPANIES USING GIN (translations);
CREATE INDEX idx_company_search_en ON business.COMPANIES 
    USING GIN (to_tsvector('english', translations->'en'->>'name'));

-- PROPERTIES
CREATE INDEX idx_property_type ON property.PROPERTIES(property_type_id);
CREATE INDEX idx_property_purpose ON property.PROPERTIES(purpose_id);
CREATE INDEX idx_property_location ON property.PROPERTIES(location_id);
CREATE INDEX idx_property_agent ON property.PROPERTIES(agent_id);
CREATE INDEX idx_property_company ON property.PROPERTIES(company_id);
CREATE INDEX idx_property_currency ON property.PROPERTIES(currency_id);
CREATE INDEX idx_property_status ON property.PROPERTIES(status);
CREATE INDEX idx_property_price ON property.PROPERTIES(price);
CREATE INDEX idx_property_reference ON property.PROPERTIES(reference_number);
CREATE INDEX idx_composite_search ON property.PROPERTIES(property_type_id, purpose_id, location_id, status);

-- JSONB indexes for property translations (CRITICAL FOR FAST SEARCH!)
CREATE INDEX idx_property_title_en ON property.PROPERTIES USING GIN ((title_translations -> 'en'));
CREATE INDEX idx_property_title_ar ON property.PROPERTIES USING GIN ((title_translations -> 'ar'));
CREATE INDEX idx_property_title_translations_gin ON property.PROPERTIES USING GIN (title_translations);
CREATE INDEX idx_property_search_title_en ON property.PROPERTIES 
    USING GIN (to_tsvector('english', title_translations->>'en'));
CREATE INDEX idx_property_search_title_ar ON property.PROPERTIES 
    USING GIN (to_tsvector('arabic', title_translations->>'ar'));
CREATE INDEX idx_property_search_desc_en ON property.PROPERTIES 
    USING GIN (to_tsvector('english', description_translations->>'en'));

-- PROPERTY_DETAILS
CREATE INDEX idx_bedrooms ON property.PROPERTY_DETAILS(bedrooms);
CREATE INDEX idx_bathrooms ON property.PROPERTY_DETAILS(bathrooms);
CREATE INDEX idx_area_sqft ON property.PROPERTY_DETAILS(area_sqft);
CREATE INDEX idx_property_details_features_gin ON property.PROPERTY_DETAILS USING GIN (features);

-- FEATURES
CREATE INDEX idx_features_key ON property.FEATURES(feature_key);
CREATE INDEX idx_features_type ON property.FEATURES(feature_type);
CREATE INDEX idx_features_active ON property.FEATURES(is_active);
-- JSONB indexes for feature translations
CREATE INDEX idx_feature_name_en ON property.FEATURES USING BTREE ((name_translations->>'en'));
CREATE INDEX idx_feature_name_ar ON property.FEATURES USING BTREE ((name_translations->>'ar'));
CREATE INDEX idx_feature_translations_gin ON property.FEATURES USING GIN (name_translations);
CREATE INDEX idx_feature_search_en ON property.FEATURES 
    USING GIN (to_tsvector('english', name_translations->>'en'));

-- PROPERTY_FEATURES
CREATE INDEX idx_property_features_property ON property.PROPERTY_FEATURES(property_id);
CREATE INDEX idx_property_features_feature ON property.PROPERTY_FEATURES(feature_id);

-- PROPERTY_IMAGES
CREATE INDEX idx_property_images_property_id ON property.PROPERTY_IMAGES(property_id);
CREATE INDEX idx_is_primary ON property.PROPERTY_IMAGES(is_primary);
CREATE INDEX idx_display_order ON property.PROPERTY_IMAGES(display_order);

-- AGENT_RATINGS (Unified - for both brokers and agents)
CREATE INDEX idx_agent_ratings_agent ON business.AGENT_RATINGS(agent_id);
CREATE INDEX idx_agent_ratings_rating ON business.AGENT_RATINGS(rating);
CREATE INDEX idx_agent_ratings_date ON business.AGENT_RATINGS(review_date);
CREATE INDEX idx_agent_ratings_verified ON business.AGENT_RATINGS(is_verified);

-- PROPERTY_VIEWS (Enhanced indexes)
CREATE INDEX idx_property_views_property_id ON property.PROPERTY_VIEWS(property_id);
CREATE INDEX idx_property_views_session ON property.PROPERTY_VIEWS(session_id);
CREATE INDEX idx_property_views_user ON property.PROPERTY_VIEWS(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_property_views_time ON property.PROPERTY_VIEWS(viewed_at DESC);
CREATE INDEX idx_property_views_session_property ON property.PROPERTY_VIEWS(session_id, property_id);
CREATE INDEX idx_property_views_session_time ON property.PROPERTY_VIEWS(session_id, viewed_at DESC);
-- Idempotent like/dislike constraints:
-- - Logged-in users: one row per (property_id, user_id)
-- - Anonymous users: one row per (property_id, session_id) when user_id is NULL
CREATE UNIQUE INDEX uq_property_views_property_user
    ON property.PROPERTY_VIEWS(property_id, user_id)
    WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_property_views_property_session_anonymous
    ON property.PROPERTY_VIEWS(property_id, session_id)
    WHERE user_id IS NULL;

-- PROPERTIES: featured lookups (featured sorted by featured_rank)
CREATE INDEX idx_properties_featured_rank
    ON property.PROPERTIES(is_featured, featured_rank)
    WHERE is_featured = TRUE;

-- SEARCH_FILTER_CONFIGS
CREATE INDEX idx_search_filter_configs_lookup
    ON master.SEARCH_FILTER_CONFIGS(is_active, purpose_key, country_id, currency_id, language_code, version DESC);
CREATE INDEX idx_search_filter_configs_active
    ON master.SEARCH_FILTER_CONFIGS(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_search_filter_configs_purpose
    ON master.SEARCH_FILTER_CONFIGS(purpose_key);
CREATE INDEX idx_search_filter_configs_config_json_gin
    ON master.SEARCH_FILTER_CONFIGS USING GIN (config_json);

-- USER_PREFERENCES indexes
CREATE INDEX idx_user_prefs_session ON user_activity.USER_PREFERENCES(session_id);
CREATE INDEX idx_user_prefs_user ON user_activity.USER_PREFERENCES(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_user_prefs_ready ON user_activity.USER_PREFERENCES(is_ready_for_recommendations) 
    WHERE is_ready_for_recommendations = TRUE;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW() AT TIME ZONE 'UTC';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON login.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON login.roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_sessions_updated_at BEFORE UPDATE ON user_activity.USER_SESSIONS
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_properties_updated_at BEFORE UPDATE ON property.PROPERTIES
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_property_details_updated_at BEFORE UPDATE ON property.PROPERTY_DETAILS
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_features_updated_at BEFORE UPDATE ON property.FEATURES
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agent_ratings_updated_at BEFORE UPDATE ON business.AGENT_RATINGS
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE ON user_activity.USER_PREFERENCES
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_languages_updated_at BEFORE UPDATE ON master.LANGUAGES
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_countries_updated_at BEFORE UPDATE ON master.COUNTRIES
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_currencies_updated_at BEFORE UPDATE ON master.CURRENCIES
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_property_types_updated_at BEFORE UPDATE ON property.PROPERTY_TYPES
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_purposes_updated_at BEFORE UPDATE ON property.PURPOSES
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON property.LOCATIONS
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agencies_updated_at BEFORE UPDATE ON business.AGENCIES
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON business.COMPANIES
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_search_filter_configs_updated_at BEFORE UPDATE ON master.SEARCH_FILTER_CONFIGS
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger: Auto-update USER_SESSIONS when property is viewed
CREATE OR REPLACE FUNCTION trigger_update_session_on_view()
RETURNS TRIGGER AS $$
BEGIN
    -- Update session view count and last activity
    UPDATE user_activity.USER_SESSIONS
    SET total_views = total_views + 1,
        last_activity_at = NOW() AT TIME ZONE 'UTC',
        updated_at = NOW() AT TIME ZONE 'UTC'
    WHERE session_id = NEW.session_id;
    
    -- If user_id is provided, also update it
    IF NEW.user_id IS NOT NULL THEN
        UPDATE user_activity.USER_SESSIONS
        SET user_id = NEW.user_id,
            updated_at = NOW() AT TIME ZONE 'UTC'
        WHERE session_id = NEW.session_id AND user_id IS NULL;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_property_view_update_session
    AFTER INSERT ON property.PROPERTY_VIEWS
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_session_on_view();

-- Trigger: Auto-set language preference on session creation
CREATE OR REPLACE FUNCTION set_default_language_on_session_create()
RETURNS TRIGGER AS $$
DECLARE
    v_default_language VARCHAR(5);
BEGIN
    -- If no preferred language set, use browser-detected or default
    IF NEW.preferred_language_code IS NULL THEN
        -- Try to use browser-detected language
        IF NEW.language_code IS NOT NULL AND EXISTS(
            SELECT 1 FROM master.LANGUAGES 
            WHERE language_code = NEW.language_code AND is_active = TRUE
        ) THEN
            NEW.preferred_language_code := NEW.language_code;
        ELSE
            -- Use default language
            SELECT language_code INTO v_default_language
            FROM master.LANGUAGES
            WHERE is_default = TRUE AND is_active = TRUE
            LIMIT 1;
            NEW.preferred_language_code := COALESCE(v_default_language, 'en');
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_default_language_on_session
BEFORE INSERT ON user_activity.USER_SESSIONS
FOR EACH ROW
EXECUTE FUNCTION set_default_language_on_session_create();

-- ============================================================================
-- HELPER FUNCTIONS FOR JSONB TRANSLATIONS
-- ============================================================================

-- Function: Get translated text with fallback
CREATE OR REPLACE FUNCTION get_translation(
    p_translations JSONB,
    p_language_code VARCHAR(5) DEFAULT 'en',
    p_fallback_language VARCHAR(5) DEFAULT 'en'
)
RETURNS TEXT AS $$
BEGIN
    -- Try requested language
    IF p_translations ? p_language_code THEN
        RETURN p_translations->>p_language_code;
    END IF;
    
    -- Fallback to default language
    IF p_translations ? p_fallback_language THEN
        RETURN p_translations->>p_fallback_language;
    END IF;
    
    -- Return first available translation
    RETURN p_translations->>(jsonb_object_keys(p_translations)::TEXT);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function: Get nested translation (for locations, agencies, companies)
CREATE OR REPLACE FUNCTION get_nested_translation(
    p_translations JSONB,
    p_field VARCHAR(50),
    p_language_code VARCHAR(5) DEFAULT 'en',
    p_fallback_language VARCHAR(5) DEFAULT 'en'
)
RETURNS TEXT AS $$
BEGIN
    -- Try requested language
    IF p_translations ? p_language_code AND p_translations->p_language_code ? p_field THEN
        RETURN p_translations->p_language_code->>p_field;
    END IF;
    
    -- Fallback to default language
    IF p_translations ? p_fallback_language AND p_translations->p_fallback_language ? p_field THEN
        RETURN p_translations->p_fallback_language->>p_field;
    END IF;
    
    -- Return NULL if not found
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- LANGUAGE PREFERENCE MANAGEMENT FUNCTIONS
-- ============================================

-- Function: Update user language preference
CREATE OR REPLACE FUNCTION update_user_language_preference(
    p_session_id VARCHAR(100),
    p_language_code VARCHAR(5),
    p_user_id UUID DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_language_exists BOOLEAN;
BEGIN
    -- Validate language code exists
    SELECT EXISTS(SELECT 1 FROM master.LANGUAGES WHERE language_code = p_language_code AND is_active = TRUE)
    INTO v_language_exists;
    
    IF NOT v_language_exists THEN
        RAISE EXCEPTION 'Language code % does not exist or is not active', p_language_code;
    END IF;
    
    -- Update session language preference
    UPDATE user_activity.USER_SESSIONS
    SET preferred_language_code = p_language_code,
        language_code = p_language_code, -- Also update detected language
        updated_at = NOW() AT TIME ZONE 'UTC'
    WHERE session_id = p_session_id;
    
    -- If user is authenticated, also update user preference
    IF p_user_id IS NOT NULL THEN
        UPDATE login.users
        SET preferred_language_code = p_language_code,
            updated_at = NOW() AT TIME ZONE 'UTC'
        WHERE id = p_user_id;
        
        -- Sync all user's active sessions
        UPDATE user_activity.USER_SESSIONS
        SET preferred_language_code = p_language_code,
            language_code = p_language_code,
            updated_at = NOW() AT TIME ZONE 'UTC'
        WHERE user_id = p_user_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function: Get user's preferred language (with fallback)
CREATE OR REPLACE FUNCTION get_user_preferred_language(
    p_session_id VARCHAR(100)
)
RETURNS VARCHAR(5) AS $$
DECLARE
    v_language_code VARCHAR(5);
    v_user_id UUID;
    v_default_language VARCHAR(5);
BEGIN
    -- Get default language
    SELECT language_code INTO v_default_language
    FROM master.LANGUAGES
    WHERE is_default = TRUE AND is_active = TRUE
    LIMIT 1;
    
    -- Get session language preference
    SELECT preferred_language_code, user_id
    INTO v_language_code, v_user_id
    FROM user_activity.USER_SESSIONS
    WHERE session_id = p_session_id;
    
    -- If session has preference, use it
    IF v_language_code IS NOT NULL THEN
        RETURN v_language_code;
    END IF;
    
    -- If user is authenticated, check user preference
    IF v_user_id IS NOT NULL THEN
        SELECT preferred_language_code INTO v_language_code
        FROM login.users
        WHERE id = v_user_id;
        
        IF v_language_code IS NOT NULL THEN
            RETURN v_language_code;
        END IF;
    END IF;
    
    -- Fallback to browser-detected language
    SELECT language_code INTO v_language_code
    FROM user_activity.USER_SESSIONS
    WHERE session_id = p_session_id;
    
    -- Final fallback to default language
    RETURN COALESCE(v_language_code, v_default_language, 'en');
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Get properties list using session's preferred language
CREATE OR REPLACE FUNCTION get_properties_list_by_session(
    p_session_id VARCHAR(100),
    p_limit INT DEFAULT 20,
    p_offset INT DEFAULT 0,
    p_status VARCHAR(20) DEFAULT 'Active'
)
RETURNS TABLE (
    property_id INT,
    title VARCHAR(500),
    description TEXT,
    price DECIMAL(15,2),
    currency_code VARCHAR(3),
    currency_symbol VARCHAR(10),
    property_type VARCHAR(100),
    purpose VARCHAR(50),
    city VARCHAR(100),
    area VARCHAR(100),
    community VARCHAR(100),
    bedrooms INT,
    bathrooms INT,
    status VARCHAR(20)
) AS $$
DECLARE
    v_language_code VARCHAR(5);
    v_fallback_language VARCHAR(5) := 'en';
BEGIN
    -- Get user's preferred language
    v_language_code := get_user_preferred_language(p_session_id);
    
    RETURN QUERY
    SELECT 
        p.property_id,
        COALESCE(p.title_translations->>v_language_code, p.title_translations->>v_fallback_language) AS title,
        COALESCE(p.description_translations->>v_language_code, p.description_translations->>v_fallback_language) AS description,
        p.price,
        c.currency_code,
        c.currency_symbol,
        COALESCE(pt.name_translations->>v_language_code, pt.name_translations->>v_fallback_language) AS property_type,
        COALESCE(pur.name_translations->>v_language_code, pur.name_translations->>v_fallback_language) AS purpose,
        COALESCE(l.translations->v_language_code->>'city', l.translations->v_fallback_language->>'city') AS city,
        COALESCE(l.translations->v_language_code->>'area', l.translations->v_fallback_language->>'area') AS area,
        COALESCE(l.translations->v_language_code->>'community', l.translations->v_fallback_language->>'community') AS community,
        pd.bedrooms,
        pd.bathrooms,
        p.status
    FROM property.PROPERTIES p
    JOIN property.PROPERTY_TYPES pt ON p.property_type_id = pt.type_id
    JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
    JOIN property.LOCATIONS l ON p.location_id = l.location_id
    LEFT JOIN property.PROPERTY_DETAILS pd ON p.property_id = pd.property_id
    JOIN master.CURRENCIES c ON p.currency_id = c.currency_id
    WHERE p.status = p_status
    ORDER BY p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Get single property with user's preferred language
CREATE OR REPLACE FUNCTION get_property_by_id(
    p_property_id INT,
    p_session_id VARCHAR(100)
)
RETURNS TABLE (
    property_id INT,
    title VARCHAR(500),
    description TEXT,
    price DECIMAL(15,2),
    currency_code VARCHAR(3),
    currency_symbol VARCHAR(10),
    property_type VARCHAR(100),
    purpose VARCHAR(50),
    city VARCHAR(100),
    area VARCHAR(100),
    community VARCHAR(100),
    bedrooms INT,
    bathrooms INT,
    status VARCHAR(20),
    completion_status VARCHAR(50),
    furnishing_status VARCHAR(50)
) AS $$
DECLARE
    v_language_code VARCHAR(5);
    v_fallback_language VARCHAR(5) := 'en';
BEGIN
    -- Get user's preferred language
    v_language_code := get_user_preferred_language(p_session_id);
    
    RETURN QUERY
    SELECT 
        p.property_id,
        COALESCE(p.title_translations->>v_language_code, p.title_translations->>v_fallback_language) AS title,
        COALESCE(p.description_translations->>v_language_code, p.description_translations->>v_fallback_language) AS description,
        p.price,
        c.currency_code,
        c.currency_symbol,
        COALESCE(pt.name_translations->>v_language_code, pt.name_translations->>v_fallback_language) AS property_type,
        COALESCE(pur.name_translations->>v_language_code, pur.name_translations->>v_fallback_language) AS purpose,
        COALESCE(l.translations->v_language_code->>'city', l.translations->v_fallback_language->>'city') AS city,
        COALESCE(l.translations->v_language_code->>'area', l.translations->v_fallback_language->>'area') AS area,
        COALESCE(l.translations->v_language_code->>'community', l.translations->v_fallback_language->>'community') AS community,
        pd.bedrooms,
        pd.bathrooms,
        p.status,
        p.completion_status,
        p.furnishing_status
    FROM property.PROPERTIES p
    JOIN property.PROPERTY_TYPES pt ON p.property_type_id = pt.type_id
    JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
    JOIN property.LOCATIONS l ON p.location_id = l.location_id
    LEFT JOIN property.PROPERTY_DETAILS pd ON p.property_id = pd.property_id
    JOIN master.CURRENCIES c ON p.currency_id = c.currency_id
    WHERE p.property_id = p_property_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Fast property list query with language support
CREATE OR REPLACE FUNCTION get_properties_list(
    p_language_code VARCHAR(5) DEFAULT 'en',
    p_limit INT DEFAULT 20,
    p_offset INT DEFAULT 0,
    p_status VARCHAR(20) DEFAULT 'Active'
)
RETURNS TABLE (
    property_id INT,
    title VARCHAR(500),
    description TEXT,
    price DECIMAL(15,2),
    currency_code VARCHAR(3),
    currency_symbol VARCHAR(10),
    property_type VARCHAR(100),
    purpose VARCHAR(50),
    city VARCHAR(100),
    area VARCHAR(100),
    community VARCHAR(100),
    bedrooms INT,
    bathrooms INT,
    status VARCHAR(20)
) AS $$
DECLARE
    v_fallback_language VARCHAR(5) := 'en';
BEGIN
    RETURN QUERY
    SELECT 
        p.property_id,
        COALESCE(p.title_translations->>p_language_code, p.title_translations->>v_fallback_language) AS title,
        COALESCE(p.description_translations->>p_language_code, p.description_translations->>v_fallback_language) AS description,
        p.price,
        c.currency_code,
        c.currency_symbol,
        COALESCE(pt.name_translations->>p_language_code, pt.name_translations->>v_fallback_language) AS property_type,
        COALESCE(pur.name_translations->>p_language_code, pur.name_translations->>v_fallback_language) AS purpose,
        COALESCE(l.translations->p_language_code->>'city', l.translations->v_fallback_language->>'city') AS city,
        COALESCE(l.translations->p_language_code->>'area', l.translations->v_fallback_language->>'area') AS area,
        COALESCE(l.translations->p_language_code->>'community', l.translations->v_fallback_language->>'community') AS community,
        pd.bedrooms,
        pd.bathrooms,
        p.status
    FROM property.PROPERTIES p
    JOIN property.PROPERTY_TYPES pt ON p.property_type_id = pt.type_id
    JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
    JOIN property.LOCATIONS l ON p.location_id = l.location_id
    LEFT JOIN property.PROPERTY_DETAILS pd ON p.property_id = pd.property_id
    JOIN master.CURRENCIES c ON p.currency_id = c.currency_id
    WHERE p.status = p_status
    ORDER BY p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- FUNCTIONS FOR USER PREFERENCE ANALYSIS
-- ============================================================================

-- Function: Analyze user preferences from views (works for both authenticated & anonymous)
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
    v_sale_count INT;
    v_rent_count INT;
    v_sale_score INT := 50;
    v_rent_score INT := 50;
    v_total INT;
    v_user_id UUID;
BEGIN
    -- Count total views
    SELECT COUNT(*) INTO v_view_count
    FROM property.PROPERTY_VIEWS
    WHERE session_id = p_session_id;
    
    -- Only analyze if >= 5 views
    IF v_view_count < 5 THEN
        UPDATE user_activity.USER_PREFERENCES
        SET is_ready_for_recommendations = FALSE,
            updated_at = NOW() AT TIME ZONE 'UTC'
        WHERE session_id = p_session_id;
        RETURN;
    END IF;
    
    -- Get user_id from session
    SELECT user_id INTO v_user_id FROM user_activity.USER_SESSIONS WHERE session_id = p_session_id;
    
    -- Analyze bedroom preferences
    SELECT 
        AVG(pd.bedrooms)::DECIMAL(5,2),
        MIN(pd.bedrooms),
        MAX(pd.bedrooms)
    INTO v_bedrooms_avg, v_bedrooms_min, v_bedrooms_max
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTY_DETAILS pd ON pv.property_id = pd.property_id
    WHERE pv.session_id = p_session_id
        AND pd.bedrooms IS NOT NULL;
    
    -- Analyze bathroom preferences
    SELECT 
        MIN(pd.bathrooms),
        MAX(pd.bathrooms)
    INTO v_bathrooms_min, v_bathrooms_max
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTY_DETAILS pd ON pv.property_id = pd.property_id
    WHERE pv.session_id = p_session_id
        AND pd.bathrooms IS NOT NULL;
    
    -- Analyze price preferences
    SELECT 
        AVG(p.price)::DECIMAL(15,2),
        MIN(p.price),
        MAX(p.price)
    INTO v_price_avg, v_price_min, v_price_max
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTIES p ON pv.property_id = p.property_id
    WHERE pv.session_id = p_session_id
        AND p.price IS NOT NULL;
    
    -- Analyze Sale vs Rent preference
    SELECT 
        COUNT(*) FILTER (WHERE pur.purpose_key = 'for_sale'),
        COUNT(*) FILTER (WHERE pur.purpose_key = 'for_rent')
    INTO v_sale_count, v_rent_count
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTIES p ON pv.property_id = p.property_id
    JOIN property.PURPOSES pur ON p.purpose_id = pur.purpose_id
    WHERE pv.session_id = p_session_id;
    
    -- Calculate preference scores (0-100)
    v_total := v_sale_count + v_rent_count;
    IF v_total > 0 THEN
        v_sale_score := (v_sale_count * 100 / v_total);
        v_rent_score := (v_rent_count * 100 / v_total);
    END IF;
    
    -- Update or insert preferences
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
        -- Array of property types viewed
        ARRAY_AGG(DISTINCT p.property_type_id) FILTER (WHERE p.property_type_id IS NOT NULL),
        -- Array of locations viewed
        ARRAY_AGG(DISTINCT p.location_id) FILTER (WHERE p.location_id IS NOT NULL),
        -- Array of purposes viewed
        ARRAY_AGG(DISTINCT p.purpose_id) FILTER (WHERE p.purpose_id IS NOT NULL),
        -- Array of features viewed
        ARRAY_AGG(DISTINCT pf.feature_id) FILTER (WHERE pf.feature_id IS NOT NULL),
        v_sale_score,
        v_rent_score,
        v_view_count,
        COUNT(DISTINCT pv.property_id),
        TRUE,
        NOW() AT TIME ZONE 'UTC',
        NOW() AT TIME ZONE 'UTC'
    FROM property.PROPERTY_VIEWS pv
    JOIN property.PROPERTIES p ON pv.property_id = p.property_id
    LEFT JOIN property.PROPERTY_FEATURES pf ON p.property_id = pf.property_id
    WHERE pv.session_id = p_session_id
    GROUP BY p_session_id
    ON CONFLICT (session_id) DO UPDATE SET
        user_id = COALESCE(EXCLUDED.user_id, user_activity.USER_PREFERENCES.user_id), -- Keep existing if new is NULL
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
        sale_preference_score = EXCLUDED.sale_preference_score,
        rent_preference_score = EXCLUDED.rent_preference_score,
        total_properties_viewed = EXCLUDED.total_properties_viewed,
        unique_properties_viewed = EXCLUDED.unique_properties_viewed,
        is_ready_for_recommendations = TRUE,
        last_analyzed_at = NOW() AT TIME ZONE 'UTC',
        updated_at = NOW() AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- INITIAL DATA (Seed Data)
-- ============================================================================

-- Insert default roles
INSERT INTO login.roles (name, description, is_system) VALUES
    ('admin', 'System administrator with full access', TRUE),
    ('agent', 'Real estate agent', FALSE),
    ('buyer', 'Property buyer', FALSE),
    ('seller', 'Property seller', FALSE),
    ('broker', 'Real estate broker', FALSE),
    ('moderator', 'Content moderator', FALSE)
ON CONFLICT (name) DO NOTHING;

-- Insert default permissions
INSERT INTO login.permissions (resource, action, description) VALUES
    -- User permissions
    ('user', 'create', 'Create new users'),
    ('user', 'read', 'View users'),
    ('user', 'update', 'Update users'),
    ('user', 'delete', 'Delete users'),
    -- Property permissions
    ('property', 'create', 'Create properties'),
    ('property', 'read', 'View properties'),
    ('property', 'update', 'Update properties'),
    ('property', 'delete', 'Delete properties'),
    ('property', 'publish', 'Publish properties'),
    -- Role permissions
    ('role', 'create', 'Create roles'),
    ('role', 'read', 'View roles'),
    ('role', 'update', 'Update roles'),
    ('role', 'delete', 'Delete roles'),
    -- Permission permissions
    ('permission', 'read', 'View permissions'),
    -- Analytics permissions
    ('analytics', 'read', 'View analytics')
ON CONFLICT (resource, action) DO NOTHING;

-- Assign permissions to admin role (all permissions)
DO $$
DECLARE
    admin_role_id UUID;
    perm_record RECORD;
BEGIN
    SELECT id INTO admin_role_id FROM login.roles WHERE name = 'admin';
    
    IF admin_role_id IS NOT NULL THEN
        FOR perm_record IN SELECT id FROM login.permissions LOOP
            INSERT INTO login.role_permissions (role_id, permission_id)
            VALUES (admin_role_id, perm_record.id)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;
END $$;

-- Languages
INSERT INTO master.LANGUAGES (language_code, language_name, language_code_3, is_default, is_rtl) VALUES
('en', 'English', 'eng', TRUE, FALSE),
('ar', 'Arabic', 'ara', FALSE, TRUE),
('fr', 'French', 'fra', FALSE, FALSE),
('ru', 'Russian', 'rus', FALSE, FALSE),
('hi', 'Hindi', 'hin', FALSE, FALSE)
ON CONFLICT DO NOTHING;

-- Countries (with JSONB translations)
INSERT INTO master.COUNTRIES (country_code, country_code_3, name_translations, timezone) VALUES
('AE', 'ARE', '{"en": "United Arab Emirates", "ar": "الإمارات العربية المتحدة"}'::JSONB, 'Asia/Dubai'),
('US', 'USA', '{"en": "United States", "ar": "الولايات المتحدة"}'::JSONB, 'America/New_York'),
('GB', 'GBR', '{"en": "United Kingdom", "ar": "المملكة المتحدة"}'::JSONB, 'Europe/London'),
('SA', 'SAU', '{"en": "Saudi Arabia", "ar": "المملكة العربية السعودية"}'::JSONB, 'Asia/Riyadh'),
('KW', 'KWT', '{"en": "Kuwait", "ar": "الكويت"}'::JSONB, 'Asia/Kuwait'),
('QA', 'QAT', '{"en": "Qatar", "ar": "قطر"}'::JSONB, 'Asia/Qatar'),
('OM', 'OMN', '{"en": "Oman", "ar": "عمان"}'::JSONB, 'Asia/Muscat'),
('BH', 'BHR', '{"en": "Bahrain", "ar": "البحرين"}'::JSONB, 'Asia/Bahrain')
ON CONFLICT DO NOTHING;

-- Currencies (with JSONB translations)
INSERT INTO master.CURRENCIES (currency_code, name_translations, currency_symbol, decimal_places) VALUES
('AED', '{"en": "United Arab Emirates Dirham", "ar": "درهم إماراتي"}'::JSONB, 'د.إ', 2),
('USD', '{"en": "US Dollar", "ar": "دولار أمريكي"}'::JSONB, '$', 2),
('GBP', '{"en": "British Pound", "ar": "جنيه إسترليني"}'::JSONB, '£', 2),
('EUR', '{"en": "Euro", "ar": "يورو"}'::JSONB, '€', 2),
('SAR', '{"en": "Saudi Riyal", "ar": "ريال سعودي"}'::JSONB, 'ر.س', 2),
('KWD', '{"en": "Kuwaiti Dinar", "ar": "دينار كويتي"}'::JSONB, 'د.ك', 3),
('QAR', '{"en": "Qatari Riyal", "ar": "ريال قطري"}'::JSONB, 'ر.ق', 2),
('OMR', '{"en": "Omani Rial", "ar": "ريال عماني"}'::JSONB, 'ر.ع.', 3),
('BHD', '{"en": "Bahraini Dinar", "ar": "دينار بحريني"}'::JSONB, '.د.ب', 3)
ON CONFLICT DO NOTHING;

-- Property Types (with JSONB translations)
INSERT INTO property.PROPERTY_TYPES (type_key, name_translations, description_translations) VALUES
(
    'villa',
    '{"en": "Villa", "ar": "فيلا", "fr": "Villa"}'::JSONB,
    '{"en": "Standalone residential property", "ar": "ممتلكات سكنية قائمة بذاتها"}'::JSONB
),
(
    'apartment',
    '{"en": "Apartment", "ar": "شقة", "fr": "Appartement"}'::JSONB,
    '{"en": "Unit in a multi-story building", "ar": "وحدة في مبنى متعدد الطوابق"}'::JSONB
),
(
    'townhouse',
    '{"en": "Townhouse", "ar": "تاونهوس", "fr": "Maison de ville"}'::JSONB,
    '{"en": "Multi-story attached property", "ar": "ممتلكات متعددة الطوابق متصلة"}'::JSONB
),
(
    'penthouse',
    '{"en": "Penthouse", "ar": "بنتهاوس", "fr": "Penthouse"}'::JSONB,
    '{"en": "Luxury apartment on top floor", "ar": "شقة فاخرة في الطابق العلوي"}'::JSONB
),
(
    'studio',
    '{"en": "Studio", "ar": "استوديو", "fr": "Studio"}'::JSONB,
    '{"en": "Single room apartment", "ar": "شقة بغرفة واحدة"}'::JSONB
)
ON CONFLICT DO NOTHING;

-- Purposes (with JSONB translations)
INSERT INTO property.PURPOSES (purpose_key, name_translations) VALUES
('for_sale', '{"en": "For Sale", "ar": "للبيع", "fr": "À vendre"}'::JSONB),
('for_rent', '{"en": "For Rent", "ar": "للإيجار", "fr": "À louer"}'::JSONB)
ON CONFLICT DO NOTHING;

-- Locations (with JSONB translations)
INSERT INTO property.LOCATIONS (country_id, emirate, translations, latitude, longitude) VALUES
(
    (SELECT country_id FROM master.COUNTRIES WHERE country_code = 'AE'),
    'Dubai',
    '{
        "en": {"city": "Dubai", "area": "Arabian Ranches", "community": "Polo Home", "sub_community": null},
        "ar": {"city": "دبي", "area": "المرابع العربية", "community": "بولو هوم", "sub_community": null}
    }'::JSONB,
    25.0657,
    55.1713
),
(
    (SELECT country_id FROM master.COUNTRIES WHERE country_code = 'AE'),
    'Ras Al Khaimah',
    '{
        "en": {"city": "Ras Al Khaimah", "area": "Mina Al Arab", "community": "Mina Al Arab", "sub_community": "Mirasol"},
        "ar": {"city": "رأس الخيمة", "area": "ميناء العرب", "community": "ميناء العرب", "sub_community": "ميراسول"}
    }'::JSONB,
    25.7895,
    55.9592
)
ON CONFLICT DO NOTHING;

-- Agencies (with JSONB translations)
INSERT INTO business.AGENCIES (agency_key, country_id, emirate, translations, phone, email) VALUES
(
    'metropolitan_premium_properties',
    (SELECT country_id FROM master.COUNTRIES WHERE country_code = 'AE'),
    'Dubai',
    '{
        "en": {"name": "Metropolitan Premium Properties", "city": "Dubai", "description": "Premium real estate agency"},
        "ar": {"name": "متروبوليتان بريميوم بروبيرتيز", "city": "دبي", "description": "وكالة عقارية متميزة"}
    }'::JSONB,
    '+97143234567',
    'info@metropolitan.ae'
)
ON CONFLICT DO NOTHING;

-- Agents (Broker - has agency_id)
INSERT INTO business.AGENTS (
    agent_name,
    email, 
    phone, 
    agency_id, 
    profile_slug, 
    is_trubroker, 
    total_properties,
    average_rating,
    total_reviews
) VALUES (
    'Jamoliddin Kholmatov',
    'jamoliddin.kholmatov@example.com', 
    '+971501234567', 
    1, -- agency_id set = broker
    'jamoliddin-kholmatov-803339', 
    TRUE, 
    3,
    4.5,
    10
)
ON CONFLICT DO NOTHING;

-- Agents (Agent - agency_id is NULL)
INSERT INTO business.AGENTS (agent_name, email, phone, whatsapp) VALUES
('Adnan Kusybi', 'adnan.kusybi@example.com', '+971501234567', '+971501234567')
ON CONFLICT DO NOTHING;

-- Companies (with JSONB translations)
INSERT INTO business.COMPANIES (company_type, company_key, country_id, translations, established_year) VALUES
(
    'Company',
    'rak_properties',
    (SELECT country_id FROM master.COUNTRIES WHERE country_code = 'AE'),
    '{"en": {"name": "RAK Properties", "bio": null, "description": "Ras Al Khaimah-based real estate developer"}, "ar": {"name": "راك بروبيرتيز", "bio": null, "description": "مطور عقاري مقره رأس الخيمة"}}'::JSONB,
    2005
),
(
    'Company',
    'emaar_properties',
    (SELECT country_id FROM master.COUNTRIES WHERE country_code = 'AE'),
    '{"en": {"name": "Emaar Properties", "bio": null, "description": "Leading real estate developer in UAE"}, "ar": {"name": "إعمار بروبيرتيز", "bio": null, "description": "مطور عقاري رائد في الإمارات"}}'::JSONB,
    1997
),
(
    'Company',
    'nakheel',
    (SELECT country_id FROM master.COUNTRIES WHERE country_code = 'AE'),
    '{"en": {"name": "Nakheel", "bio": null, "description": "Dubai-based property developer"}, "ar": {"name": "نخيل", "bio": null, "description": "مطور عقاري مقره دبي"}}'::JSONB,
    2001
),
(
    'Company',
    'abc_real_estate_llc',
    (SELECT country_id FROM master.COUNTRIES WHERE country_code = 'AE'),
    '{"en": {"name": "ABC Real Estate LLC", "bio": null, "description": "Real estate investment company"}, "ar": {"name": "ABC للعقارات ذ.م.م", "bio": null, "description": "شركة استثمار عقاري"}}'::JSONB,
    2010
)
ON CONFLICT DO NOTHING;

-- Properties (with JSONB translations)
INSERT INTO property.PROPERTIES (
    title_translations,
    description_translations,
    property_type_id, 
    purpose_id, 
    location_id,
    company_id,
    agent_id,
    currency_id,
    price,
    reference_number,
    completion_status,
    furnishing_status,
    added_date
) VALUES (
    '{"en": "Largest Pool | Upgraded | Exclusive | Unfurnished", "ar": "أكبر مسبح | محدث | حصري | غير مفروش"}'::JSONB,
    '{"en": "6 Bedroom Villa for Sale in Polo Home, Arabian Ranches", "ar": "فيلا 6 غرف نوم للبيع في بولو هوم، المرابع العربية"}'::JSONB,
    1, -- Villa
    1, -- For Sale
    1, -- Location ID
    4, -- company_id = ABC Real Estate LLC owns this property
    1, -- Agent ID (broker since agency_id is set)
    (SELECT currency_id FROM master.CURRENCIES WHERE currency_code = 'AED'), -- Currency ID
    3315502.00,
    'Bayut-B-Dec-Three-Twenty-Five-VS-153849',
    'Ready',
    'Unfurnished',
    NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT DO NOTHING;

-- Property Details
INSERT INTO property.PROPERTY_DETAILS (
    property_id,
    bedrooms,
    bathrooms,
    area_sqft,
    area_sqm
) VALUES (
    1,
    6,
    NULL,
    NULL,
    NULL
)
ON CONFLICT DO NOTHING;

-- Features (with JSONB translations)
INSERT INTO property.FEATURES (feature_key, feature_type, icon_url, display_order, name_translations, description_translations) VALUES
('swimming_pool', 'Amenity', '/icons/pool.svg', 1, '{"en": "Swimming Pool", "ar": "مسبح"}'::JSONB, NULL),
('garden', 'Amenity', '/icons/garden.svg', 2, '{"en": "Garden", "ar": "حديقة"}'::JSONB, NULL),
('maid_room', 'Amenity', '/icons/maid-room.svg', 3, '{"en": "Maid Room", "ar": "غرفة خادمة"}'::JSONB, NULL),
('study_room', 'Feature', '/icons/study.svg', 4, '{"en": "Study Room", "ar": "غرفة دراسة"}'::JSONB, NULL),
('parking', 'Utility', '/icons/parking.svg', 5, '{"en": "Parking", "ar": "موقف سيارات"}'::JSONB, NULL),
('balcony', 'Feature', '/icons/balcony.svg', 6, '{"en": "Balcony", "ar": "شرفة"}'::JSONB, NULL),
('gym', 'Amenity', '/icons/gym.svg', 7, '{"en": "Gym", "ar": "صالة رياضية"}'::JSONB, NULL),
('security', 'Utility', '/icons/security.svg', 8, '{"en": "Security", "ar": "أمن"}'::JSONB, NULL),
('large_pool', 'Amenity', '/icons/pool.svg', 9, '{"en": "Large Pool", "ar": "مسبح كبير"}'::JSONB, NULL),
('upgraded', 'Feature', '/icons/upgraded.svg', 10, '{"en": "Upgraded", "ar": "محدث"}'::JSONB, NULL),
('exclusive', 'Feature', '/icons/exclusive.svg', 11, '{"en": "Exclusive", "ar": "حصري"}'::JSONB, NULL)
ON CONFLICT DO NOTHING;

-- Assign Features to Property
INSERT INTO property.PROPERTY_FEATURES (property_id, feature_id) VALUES
(1, (SELECT feature_id FROM property.FEATURES WHERE feature_key = 'swimming_pool')),
(1, (SELECT feature_id FROM property.FEATURES WHERE feature_key = 'large_pool')),
(1, (SELECT feature_id FROM property.FEATURES WHERE feature_key = 'garden')),
(1, (SELECT feature_id FROM property.FEATURES WHERE feature_key = 'parking')),
(1, (SELECT feature_id FROM property.FEATURES WHERE feature_key = 'maid_room')),
(1, (SELECT feature_id FROM property.FEATURES WHERE feature_key = 'study_room')),
(1, (SELECT feature_id FROM property.FEATURES WHERE feature_key = 'upgraded')),
(1, (SELECT feature_id FROM property.FEATURES WHERE feature_key = 'exclusive'))
ON CONFLICT DO NOTHING;

-- Agent Ratings (works for both brokers and agents)
INSERT INTO business.AGENT_RATINGS (
    agent_id,
    reviewer_name,
    rating,
    review_text,
    review_date,
    is_verified
) VALUES (
    1, -- Agent ID (broker in this case)
    'John Doe',
    5,
    'Excellent service! Very professional and helpful.',
    CURRENT_DATE,
    TRUE
)
ON CONFLICT DO NOTHING;
