import { NextRequest } from 'next/server';
import { getUserByEmail, setEmailVerificationToken } from '@/lib/db/queries/users';
import { generateToken } from '@/lib/auth/password';
import { sendVerificationEmail } from '@/lib/email/send';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { resendVerificationSchema } from '@/lib/security/validation';
async function handler(request: NextRequest) {
  try {
    const body = await validateBody(request, resendVerificationSchema);

    const user = await getUserByEmail(body.email);

    // Always return success (security: don't reveal if email exists)
    if (user && !user.email_verified) {
      const token = generateToken();
      await setEmailVerificationToken(user.email, token);

      try {
        await sendVerificationEmail(user.email, token);
      } catch (err) {
        // Don't fail the endpoint (avoid leaking account existence / keep UX stable)
        console.error('Failed to resend verification email:', err);
      }
    }

    return createSuccessResponse({
      message: 'If an account exists with this email, a verification link has been sent.',
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = handler;







