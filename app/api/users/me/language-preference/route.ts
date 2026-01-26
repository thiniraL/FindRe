import { NextRequest } from 'next/server';
import { updateUserLanguagePreference } from '@/lib/db/queries/users';
import { syncUserSessionsLanguage } from '@/lib/db/queries/sessions';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { AppError } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { updateLanguagePreferenceSchema } from '@/lib/security/validation';
import { withAuth } from '@/lib/auth/middleware';
import { JWTPayload } from '@/lib/types/auth';

async function handler(request: NextRequest, user: JWTPayload) {
  try {
    if (request.method !== 'POST') {
      return createErrorResponse(
        new AppError('Method not allowed', 405, 'METHOD_NOT_ALLOWED')
      );
    }

    const body = await validateBody(request, updateLanguagePreferenceSchema);

    // Update user language preference
    const updatedUser = await updateUserLanguagePreference(
      user.userId,
      body.languageCode
    );

    // Sync language preference across all active sessions
    await syncUserSessionsLanguage(user.userId, body.languageCode);

    return createSuccessResponse({
      message: 'Language preference updated successfully',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        preferredLanguageCode: updatedUser.preferred_language_code,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = withAuth(handler);

