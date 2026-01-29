import { NextRequest } from 'next/server';
import {
  AppError,
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/utils/errors';
import { analyzePreferences, getPreferencesSummary } from '@/lib/db/queries/preferences';

function getSessionId(request: NextRequest): string {
  const sessionId = request.headers.get('x-session-id');
  if (!sessionId || !sessionId.trim()) {
    throw new AppError('Missing x-session-id header', 400, 'SESSION_ID_REQUIRED');
  }
  return sessionId.trim();
}

export async function POST(request: NextRequest) {
  try {
    const sessionId = getSessionId(request);

    await analyzePreferences(sessionId);
    const prefs = await getPreferencesSummary(sessionId);

    return createSuccessResponse({
      sessionId,
      preferences: prefs
        ? {
            sessionId: prefs.session_id,
            userId: prefs.user_id,
            totalPropertiesViewed: prefs.total_properties_viewed,
            uniquePropertiesViewed: prefs.unique_properties_viewed,
            isReadyForRecommendations: prefs.is_ready_for_recommendations,
            lastAnalyzedAt: prefs.last_analyzed_at,
            updatedAt: prefs.updated_at,
          }
        : null,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

