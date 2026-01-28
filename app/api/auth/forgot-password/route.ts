import { NextRequest } from 'next/server';
import { getUserByEmail, setPasswordResetToken } from '@/lib/db/queries/users';
import { generateToken } from '@/lib/auth/password';
import { sendPasswordResetEmail } from '@/lib/email/send';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { forgotPasswordSchema } from '@/lib/security/validation';
import { withRateLimit, rateLimits } from '@/lib/security/rate-limit';

async function handler(request: NextRequest) {
  try {
    const body = await validateBody(request, forgotPasswordSchema);

    console.info('Forgot password request received', { email: body.email });

    // Get user
    const user = await getUserByEmail(body.email);
    
    // Always return success (security: don't reveal if email exists)
    if (user) {
      // Generate reset token
      const resetToken = generateToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      console.info('Password reset token generated', { userId: user.id, email: user.email });
      await setPasswordResetToken(user.email, resetToken, expiresAt);
      console.info('Password reset token stored', { userId: user.id, email: user.email });

      try {
        console.info('Sending password reset email', { email: user.email });
        await sendPasswordResetEmail(user.email, resetToken);
        console.info('Password reset email sent', { email: user.email });
      } catch (err) {
        // Don't fail the endpoint (avoid leaking account existence / keep UX stable)
        console.error('Failed to send password reset email:', err);
      }
    } else {
      console.info('Forgot password request for unknown email', { email: body.email });
    }

    return createSuccessResponse({
      message: 'If an account exists with this email, a password reset link has been sent.',
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = withRateLimit(rateLimits.passwordReset)(handler);





