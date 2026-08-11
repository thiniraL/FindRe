import { NextRequest } from 'next/server';
import { getUserByIdWithPassword, updateUserPassword } from '@/lib/db/queries/users';
import { revokeAllUserRefreshTokens } from '@/lib/db/queries/tokens';
import { verifyPassword } from '@/lib/auth/password';
import { withAuth } from '@/lib/auth/middleware';
import { AppError, createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody, changePasswordSchema } from '@/lib/security/validation';
import type { JWTPayload } from '@/lib/types/auth';

async function handler(request: NextRequest, authUser: JWTPayload) {
  try {
    const body = await validateBody(request, changePasswordSchema);

    const user = await getUserByIdWithPassword(authUser.userId);
    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    if (!user.is_active) {
      throw new AppError('Account is disabled', 403, 'ACCOUNT_DISABLED');
    }

    const isCurrentValid = await verifyPassword(user.password_hash, body.currentPassword);
    if (!isCurrentValid) {
      throw new AppError('Current password is incorrect', 401, 'INVALID_CURRENT_PASSWORD');
    }

    await updateUserPassword(user.id, body.newPassword);

    // Invalidate other sessions after a password change
    await revokeAllUserRefreshTokens(user.id);

    return createSuccessResponse({
      message: 'Password changed successfully',
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = withAuth(handler);
