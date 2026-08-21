import { query } from '@/lib/db/client';
import { feedPrefsCache } from '@/lib/cache';

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

// Top-level keys (e.g. "bedrooms", "bathrooms") each contain a map of bucket/value -> count.
export type PreferenceCounters = Record<string, Record<string, number>>;

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
  // JSONB tallies from USER_PREFERENCES.preference_counters
  // Shape (example):
  // {
  //   bedrooms: { "1": 2, "2": 5 },
  //   bathrooms: { "1": 1, "2": 4 },
  //   price_buckets: { "0-1000000": 3, "1000000-2000000": 2 },
  //   property_types: { "1": 4, "2": 1 },
  //   features: { "swimming_pool": 3, "garden": 1 }
  // }
  preference_counters: PreferenceCounters | null;
  total_properties_viewed: number;
  unique_properties_viewed: number;
  is_ready_for_recommendations: boolean;
  last_analyzed_at: string | null;
  updated_at: string;
};

async function clearFeedPrefsCacheForSessionAndUser(
  sessionId: string,
  userId?: string | null
): Promise<void> {
  feedPrefsCache.delete(`feed_prefs:${sessionId}`);

  const res = await query<{ session_id: string }>(
    `
    SELECT DISTINCT s.session_id
    FROM user_activity.USER_SESSIONS s
    WHERE s.session_id = $1
       OR (
         $2::uuid IS NOT NULL
         AND s.user_id = $2::uuid
       )
       OR (
         s.user_id IS NOT NULL
         AND s.user_id = (
           SELECT user_id
           FROM user_activity.USER_SESSIONS
           WHERE session_id = $1
             AND user_id IS NOT NULL
         )
       )
    `,
    [sessionId, userId ?? null]
  );

  for (const row of res.rows) {
    feedPrefsCache.delete(`feed_prefs:${row.session_id}`);
  }
}

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

  const row = res.rows[0];

  // Keep every preference row for this logged-in user aligned with onboarding edits
  if (options.userId) {
    await query(
      `
      UPDATE user_activity.USER_PREFERENCES
      SET
        preferred_bedrooms_min = COALESCE($2, preferred_bedrooms_min),
        preferred_bedrooms_max = COALESCE($3, preferred_bedrooms_max),
        preferred_bathrooms_min = COALESCE($4, preferred_bathrooms_min),
        preferred_bathrooms_max = COALESCE($5, preferred_bathrooms_max),
        preferred_price_min = COALESCE($6, preferred_price_min),
        preferred_price_max = COALESCE($7, preferred_price_max),
        preferred_property_type_ids = COALESCE($8, preferred_property_type_ids),
        preferred_location_ids = COALESCE($9, preferred_location_ids),
        preferred_purpose_ids = COALESCE($10, preferred_purpose_ids),
        preferred_feature_ids = COALESCE($11, preferred_feature_ids),
        user_id = $1,
        updated_at = NOW() AT TIME ZONE 'UTC'
      WHERE user_id = $1
         OR session_id IN (
           SELECT session_id
           FROM user_activity.USER_SESSIONS
           WHERE user_id = $1
         )
      `,
      [
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
  }

  await clearFeedPrefsCacheForSessionAndUser(options.sessionId, options.userId);
  return row;
}

export async function analyzePreferences(sessionId: string): Promise<void> {
  await query(`SELECT analyze_user_preferences($1)`, [sessionId]);
  await clearFeedPrefsCacheForSessionAndUser(sessionId);
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
  /** Same JSONB tallies as in UserPreferencesRow */
  preference_counters: PreferenceCounters | null;
  /** Pre-computed Typesense _eval sort string; used by feed when present */
  typesense_feed_sort_by: string | null;
  /** TRUE only after user/session viewed every PROPERTIES.is_featured=TRUE listing. Prefs refresh at 5/10/15… */
  is_ready_for_recommendations: boolean;
  /** Set when analyze_user_preferences last completed; feed clients use as preferencesGeneration */
  last_analyzed_at: string | null;
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
      preference_counters,
      typesense_feed_sort_by,
      is_ready_for_recommendations,
      last_analyzed_at
    FROM user_activity.USER_PREFERENCES
    WHERE session_id = $1
    `,
    [sessionId]
  );

  return res.rows[0] || null;
}

/** Indexed lookup; use in parallel with Typesense when feed prefs are cached so meta stays fresh after DB trigger analysis. */
export async function getLastAnalyzedAtForSession(sessionId: string): Promise<string | null> {
  const res = await query<{ last_analyzed_at: string | null }>(
    `
    SELECT last_analyzed_at
    FROM user_activity.USER_PREFERENCES
    WHERE session_id = $1
    `,
    [sessionId]
  );
  return res.rows[0]?.last_analyzed_at ?? null;
}
