import { NextRequest } from 'next/server';
import { createOrUpdateUserSession } from '@/lib/db/queries/sessions';
import {
  AppError,
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/utils/errors';
import {
  onboardingPreferencesSchema,
  validateBody,
} from '@/lib/security/validation';
import { upsertOnboardingPreferences } from '@/lib/db/queries/preferences';

function getSessionId(request: NextRequest): string {
  const sessionId = request.headers.get('x-session-id');
  if (!sessionId || !sessionId.trim()) {
    throw new AppError('Missing x-session-id header', 400, 'SESSION_ID_REQUIRED');
  }
  return sessionId.trim();
}

function getClientInfo(request: NextRequest): { ipAddress: string; userAgent?: string } {
  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown';
  const userAgent = request.headers.get('user-agent') || undefined;
  return { ipAddress, userAgent };
}

export async function POST(request: NextRequest) {
  try {
    const sessionId = getSessionId(request);
    const body = await validateBody(request, onboardingPreferencesSchema);
    const { ipAddress, userAgent } = getClientInfo(request);

    const session = await createOrUpdateUserSession(sessionId, {
      userId: null,
      ipAddress,
      userAgent,
      countryCode: null,
      languageCode: null,
      preferredLanguageCode: null,
    });

    const prefs = await upsertOnboardingPreferences({
      sessionId,
      userId: session.user_id,
      input: body,
    });

    return createSuccessResponse({
      sessionId: prefs.session_id,
      userId: prefs.user_id,
      preferences: {
        preferredBedroomsMin: prefs.preferred_bedrooms_min,
        preferredBedroomsMax: prefs.preferred_bedrooms_max,
        preferredBathroomsMin: prefs.preferred_bathrooms_min,
        preferredBathroomsMax: prefs.preferred_bathrooms_max,
        preferredPriceMin: prefs.preferred_price_min,
        preferredPriceMax: prefs.preferred_price_max,
        preferredPropertyTypeIds: prefs.preferred_property_type_ids,
        preferredLocationIds: prefs.preferred_location_ids,
        preferredPurposeIds: prefs.preferred_purpose_ids,
        preferredFeatureIds: prefs.preferred_feature_ids,
        isReadyForRecommendations: prefs.is_ready_for_recommendations,
        lastAnalyzedAt: prefs.last_analyzed_at,
        updatedAt: prefs.updated_at,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

