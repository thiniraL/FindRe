import { NextRequest } from 'next/server';
import { getUserByEmail, setPasswordResetToken } from '@/lib/db/queries/users';
import { generateVerificationOtp } from '@/lib/auth/password';
import { sendPasswordResetEmailWithOtp, formatEmailError } from '@/lib/email/send';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { forgotPasswordSchema } from '@/lib/security/validation';
async function handler(request: NextRequest) {
  try {
    const body = await validateBody(request, forgotPasswordSchema);

    console.info('Forgot password request received', { email: body.email });

    // Get user
    const user = await getUserByEmail(body.email);
    
    // Always return success (security: don't reveal if email exists)
    if (user) {
      // Generate 6-digit reset code
      const resetCode = generateVerificationOtp();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      console.info('Password reset code generated', { userId: user.id, email: user.email });
      await setPasswordResetToken(user.email, resetCode, expiresAt);
      console.info('Password reset code stored', { userId: user.id, email: user.email });

      try {
        console.info('Sending password reset email', { email: user.email });
        await sendPasswordResetEmailWithOtp(user.email, resetCode);
        console.info('Password reset email sent', { email: user.email });
      } catch (err) {
        // Don't fail the endpoint (avoid leaking account existence / keep UX stable)
        console.error('Failed to send password reset email:', formatEmailError(err));
      }
    } else {
      console.info('Forgot password request for unknown email', { email: body.email });
    }

    return createSuccessResponse({
      message: 'If an account exists with this email, a password reset code has been sent.',
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = handler;





