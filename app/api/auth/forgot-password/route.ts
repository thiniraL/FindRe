import { NextRequest } from 'next/server';
import { getUserByEmail, setPasswordResetToken } from '@/lib/db/queries/users';
import { generateToken } from '@/lib/auth/password';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { forgotPasswordSchema } from '@/lib/security/validation';
import { withRateLimit, rateLimits } from '@/lib/security/rate-limit';

async function handler(request: NextRequest) {
  try {
    const body = await validateBody(request, forgotPasswordSchema);

    // Get user
    const user = await getUserByEmail(body.email);
    
    // Always return success (security: don't reveal if email exists)
    if (user) {
      // Generate reset token
      const resetToken = generateToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await setPasswordResetToken(user.email, resetToken, expiresAt);

      // TODO: Send email with reset link
      // await sendPasswordResetEmail(user.email, resetToken);
    }

    return createSuccessResponse({
      message: 'If an account exists with this email, a password reset link has been sent.',
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = withRateLimit(rateLimits.passwordReset)(handler);




