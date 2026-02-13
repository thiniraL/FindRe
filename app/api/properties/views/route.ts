import { NextRequest } from 'next/server';
import { createOrUpdateUserSession } from '@/lib/db/queries/sessions';
import { verifyAccessToken } from '@/lib/auth/jwt';
import {
  AppError,
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/utils/errors';
import { propertyViewSchema, validateBody } from '@/lib/security/validation';
import {
  bumpSessionActivityAndViews,
  upsertPropertyView,
} from '@/lib/db/queries/propertyViews';
import { analyzePreferences } from '@/lib/db/queries/preferences';

function getSessionId(request: NextRequest): string {
  const sessionId = request.headers.get('x-session-id');
  if (!sessionId || !sessionId.trim()) {
    throw new AppError('Missing x-session-id header', 400, 'SESSION_ID_REQUIRED');
  }
  return sessionId.trim();
}

function getClientInfo(request: NextRequest): {
  ipAddress: string;
  userAgent?: string;
} {
  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown';
  const userAgent = request.headers.get('user-agent') || undefined;
  return { ipAddress, userAgent };
}

function tryGetUserIdFromAuthHeader(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7).trim();
  if (!token) return null;
  try {
    const payload = verifyAccessToken(token);
    return payload.userId;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const sessionId = getSessionId(request);
    const body = await validateBody(request, propertyViewSchema);
    const { ipAddress, userAgent } = getClientInfo(request);
    const userId = tryGetUserIdFromAuthHeader(request);

    const session = await createOrUpdateUserSession(sessionId, {
      userId,
      ipAddress,
      userAgent,
      countryCode: null,
      languageCode: null,
      preferredLanguageCode: null,
    });

    const viewedAt =
      body.viewedAt ? new Date(body.viewedAt).toISOString() : new Date().toISOString();

    const viewRow = await upsertPropertyView({
      sessionId,
      userId: session.user_id,
      propertyId: body.propertyId,
      viewedAtIso: viewedAt,
      viewDurationSeconds: body.viewDurationSeconds,
      ipAddress,
      userAgent,
      is_like: body.is_like,
    });

    await bumpSessionActivityAndViews(sessionId);

    // Analysis at 5, 10, 15, … views is done by DB trigger (trg_analyze_preferences_on_property_view).
    // Only call from app when client requests on-demand.
    let analyzed = false;
    if (body.analyzeNow) {
      await analyzePreferences(sessionId);
      analyzed = true;
    }

    return createSuccessResponse({
      sessionId,
      userId: session.user_id,
      view: {
        viewId: viewRow.view_id,
        propertyId: viewRow.property_id,
        viewedAt: viewRow.viewed_at,
        viewDurationSeconds: viewRow.view_duration_seconds,
        isLiked: viewRow.is_liked,
        isDisliked: viewRow.is_disliked,
        feedbackAt: viewRow.feedback_at,
      },
      analyzed,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

