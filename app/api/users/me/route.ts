import { NextRequest } from 'next/server';
import { getUserById, updateUser } from '@/lib/db/queries/users';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { updateUserSchema } from '@/lib/security/validation';
import { withAuth } from '@/lib/auth/middleware';
import type { JWTPayload, User } from '@/lib/types/auth';

async function handler(request: NextRequest, user: JWTPayload) {
  try {
    if (request.method === 'GET') {
      const currentUser = await getUserById(user.userId);
      if (!currentUser) {
        return createErrorResponse(new Error('User not found'));
      }

      return createSuccessResponse({
        user: {
          id: currentUser.id,
          email: currentUser.email,
          emailVerified: currentUser.email_verified,
          twoFactorEnabled: currentUser.two_factor_enabled,
          lastLogin: currentUser.last_login,
          isActive: currentUser.is_active,
          preferredLanguageCode: currentUser.preferred_language_code,
          createdAt: currentUser.created_at,
          updatedAt: currentUser.updated_at,
        },
      });
    }

    if (request.method === 'PATCH') {
      const body = await validateBody(request, updateUserSchema);

      const updates: Partial<User> = {};
      if (body.email !== undefined) {
        updates.email = body.email;
      }
      if (body.twoFactorEnabled !== undefined) {
        updates.two_factor_enabled = body.twoFactorEnabled;
      }
      if (body.preferredLanguageCode !== undefined) {
        updates.preferred_language_code = body.preferredLanguageCode;
      }

      const updatedUser = await updateUser(user.userId, updates);

      // Sync language preference across all active sessions
      if (body.preferredLanguageCode !== undefined) {
        const { syncUserSessionsLanguage } = await import('@/lib/db/queries/sessions');
        await syncUserSessionsLanguage(user.userId, body.preferredLanguageCode);
      }

      return createSuccessResponse({
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          emailVerified: updatedUser.email_verified,
          twoFactorEnabled: updatedUser.two_factor_enabled,
          lastLogin: updatedUser.last_login,
          isActive: updatedUser.is_active,
          preferredLanguageCode: updatedUser.preferred_language_code,
          createdAt: updatedUser.created_at,
          updatedAt: updatedUser.updated_at,
        },
      });
    }

    return createErrorResponse(new Error('Method not allowed'));
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const GET = withAuth(handler);
export const PATCH = withAuth(handler);

