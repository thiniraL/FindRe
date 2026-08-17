import { NextRequest } from 'next/server';
import { getUserById, deleteUserAccountFully } from '@/lib/db/queries/users';
import { withAuth } from '@/lib/auth/middleware';
import { AppError, createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody, deleteAccountSchema } from '@/lib/security/validation';
import type { JWTPayload } from '@/lib/types/auth';

/**
 * DELETE /api/auth/delete-account
 * Permanently deletes the authenticated user's account and related data
 * (sessions, preferences, views/likes, tokens, identities, roles).
 *
 * Body: { "confirm": true }
 * Auth: Bearer access token
 */
async function handler(request: NextRequest, authUser: JWTPayload) {
  try {
    await validateBody(request, deleteAccountSchema);

    const user = await getUserById(authUser.userId);
    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    await deleteUserAccountFully(user.id);

    return createSuccessResponse({
      message: 'Account deleted successfully',
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const DELETE = withAuth(handler);
export const POST = withAuth(handler);
