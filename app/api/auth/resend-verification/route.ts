import { NextRequest } from 'next/server';
import { getUserByEmail, setEmailVerificationToken, EMAIL_VERIFICATION_OTP_TTL_MS } from '@/lib/db/queries/users';
import { generateVerificationOtp } from '@/lib/auth/password';
import { sendVerificationEmailWithOtp, formatEmailError } from '@/lib/email/send';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { resendVerificationSchema } from '@/lib/security/validation';

async function handler(request: NextRequest) {
  try {
    const body = await validateBody(request, resendVerificationSchema);

    const user = await getUserByEmail(body.email);

    // Always return success (security: don't reveal if email exists)
    if (user && !user.email_verified) {
      const otp = generateVerificationOtp();
      await setEmailVerificationToken(user.email, otp);

      try {
        await sendVerificationEmailWithOtp(user.email, otp);
      } catch (err) {
        console.error('Failed to resend verification email:', formatEmailError(err));
      }
    }

    // Same message whether we sent mail or not (avoid email-enumeration). Not an error — HTTP 200.
    return createSuccessResponse({
      message:
        'Check your email for a verification code. If nothing arrives, confirm the address or try again in a few minutes.',
      expiresInSeconds: Math.floor(EMAIL_VERIFICATION_OTP_TTL_MS / 1000),
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = handler;
