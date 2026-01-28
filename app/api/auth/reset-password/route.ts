import { NextRequest } from 'next/server';
import { resetPassword } from '@/lib/db/queries/users';
import { revokeAllUserRefreshTokens } from '@/lib/db/queries/tokens';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { resetPasswordSchema } from '@/lib/security/validation';
import { withRateLimit, rateLimits } from '@/lib/security/rate-limit';

async function handler(request: NextRequest) {
  try {
    const body = await validateBody(request, resetPasswordSchema);

    // Reset password
    const user = await resetPassword(body.token, body.newPassword);

    // Revoke all refresh tokens for security
    await revokeAllUserRefreshTokens(user.id);

    return createSuccessResponse({
      message: 'Password reset successfully',
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = withRateLimit(rateLimits.passwordReset)(handler);










