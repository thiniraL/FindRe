import { query } from '@/lib/db/client';

export type OnboardingPreferencesUpsertInput = {
  preferredBedroomsMin?: number;
  preferredBedroomsMax?: number;
  preferredBathroomsMin?: number;
  preferredBathroomsMax?: number;
  preferredPriceMin?: number;
  preferredPriceMax?: number;
  preferredPropertyTypeIds?: number[];
  preferredLocationIds?: number[];
  preferredPurposeIds?: number[];
  preferredFeatureIds?: number[];
};

export type UserPreferencesRow = {
  session_id: string;
  user_id: string | null;
  preferred_bedrooms_min: number | null;
  preferred_bedrooms_max: number | null;
  preferred_bathrooms_min: number | null;
  preferred_bathrooms_max: number | null;
  preferred_price_min: string | number | null;
  preferred_price_max: string | number | null;
  preferred_property_type_ids: number[] | null;
  preferred_location_ids: number[] | null;
  preferred_purpose_ids: number[] | null;
  preferred_feature_ids: number[] | null;
  total_properties_viewed: number;
  unique_properties_viewed: number;
  is_ready_for_recommendations: boolean;
  last_analyzed_at: string | null;
  updated_at: string;
};

export async function upsertOnboardingPreferences(options: {
  sessionId: string;
  userId: string | null;
  input: OnboardingPreferencesUpsertInput;
}): Promise<UserPreferencesRow> {
  const body = options.input;

  const res = await query<UserPreferencesRow>(
    `
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
      updated_at
    ) VALUES (
      $1,
      $2,
      $3,
      $4,
      NULL,
      $5,
      $6,
      $7,
      $8,
      NULL,
      $9,
      $10,
      $11,
      $12,
      NOW() AT TIME ZONE 'UTC'
    )
    ON CONFLICT (session_id) DO UPDATE SET
      user_id = COALESCE(EXCLUDED.user_id, user_activity.USER_PREFERENCES.user_id),
      preferred_bedrooms_min = COALESCE(EXCLUDED.preferred_bedrooms_min, user_activity.USER_PREFERENCES.preferred_bedrooms_min),
      preferred_bedrooms_max = COALESCE(EXCLUDED.preferred_bedrooms_max, user_activity.USER_PREFERENCES.preferred_bedrooms_max),
      preferred_bathrooms_min = COALESCE(EXCLUDED.preferred_bathrooms_min, user_activity.USER_PREFERENCES.preferred_bathrooms_min),
      preferred_bathrooms_max = COALESCE(EXCLUDED.preferred_bathrooms_max, user_activity.USER_PREFERENCES.preferred_bathrooms_max),
      preferred_price_min = COALESCE(EXCLUDED.preferred_price_min, user_activity.USER_PREFERENCES.preferred_price_min),
      preferred_price_max = COALESCE(EXCLUDED.preferred_price_max, user_activity.USER_PREFERENCES.preferred_price_max),
      preferred_property_type_ids = COALESCE(EXCLUDED.preferred_property_type_ids, user_activity.USER_PREFERENCES.preferred_property_type_ids),
      preferred_location_ids = COALESCE(EXCLUDED.preferred_location_ids, user_activity.USER_PREFERENCES.preferred_location_ids),
      preferred_purpose_ids = COALESCE(EXCLUDED.preferred_purpose_ids, user_activity.USER_PREFERENCES.preferred_purpose_ids),
      preferred_feature_ids = COALESCE(EXCLUDED.preferred_feature_ids, user_activity.USER_PREFERENCES.preferred_feature_ids),
      updated_at = NOW() AT TIME ZONE 'UTC'
    RETURNING *
    `,
    [
      options.sessionId,
      options.userId,
      body.preferredBedroomsMin ?? null,
      body.preferredBedroomsMax ?? null,
      body.preferredBathroomsMin ?? null,
      body.preferredBathroomsMax ?? null,
      body.preferredPriceMin ?? null,
      body.preferredPriceMax ?? null,
      body.preferredPropertyTypeIds ?? null,
      body.preferredLocationIds ?? null,
      body.preferredPurposeIds ?? null,
      body.preferredFeatureIds ?? null,
    ]
  );

  return res.rows[0];
}

export async function analyzePreferences(sessionId: string): Promise<void> {
  await query(`SELECT analyze_user_preferences($1)`, [sessionId]);
}

type PreferencesSummaryRow = {
  session_id: string;
  user_id: string | null;
  total_properties_viewed: number;
  unique_properties_viewed: number;
  is_ready_for_recommendations: boolean;
  last_analyzed_at: string | null;
  updated_at: string;
};

export async function getPreferencesSummary(
  sessionId: string
): Promise<
  | PreferencesSummaryRow
  | null
> {
  const res = await query<PreferencesSummaryRow>(
    `
    SELECT
      session_id,
      user_id,
      total_properties_viewed,
      unique_properties_viewed,
      is_ready_for_recommendations,
      last_analyzed_at,
      updated_at
    FROM user_activity.USER_PREFERENCES
    WHERE session_id = $1
    `,
    [sessionId]
  );

  return res.rows[0] || null;
}

type PreferencesForFeedRow = {
  session_id: string;
  user_id: string | null;
  preferred_bedrooms_min: number | null;
  preferred_bedrooms_max: number | null;
  preferred_bathrooms_min: number | null;
  preferred_bathrooms_max: number | null;
  preferred_price_min: string | number | null;
  preferred_price_max: string | number | null;
  preferred_property_type_ids: number[] | null;
  preferred_location_ids: number[] | null;
  preferred_purpose_ids: number[] | null;
  preferred_feature_ids: number[] | null;
  is_ready_for_recommendations: boolean;
};

export async function getPreferencesForFeed(
  sessionId: string
): Promise<PreferencesForFeedRow | null> {
  const res = await query<PreferencesForFeedRow>(
    `
    SELECT
      session_id,
      user_id,
      preferred_bedrooms_min,
      preferred_bedrooms_max,
      preferred_bathrooms_min,
      preferred_bathrooms_max,
      preferred_price_min,
      preferred_price_max,
      preferred_property_type_ids,
      preferred_location_ids,
      preferred_purpose_ids,
      preferred_feature_ids,
      is_ready_for_recommendations
    FROM user_activity.USER_PREFERENCES
    WHERE session_id = $1
    `,
    [sessionId]
  );

  return res.rows[0] || null;
}

