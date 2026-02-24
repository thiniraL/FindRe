import { NextRequest } from 'next/server';
import { getUserByEmail } from '@/lib/db/queries/users';
import { generateVerificationOtp } from '@/lib/auth/password';
import { sendVerificationEmailWithOtp, formatEmailError } from '@/lib/email/send';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { resendVerificationSchema } from '@/lib/security/validation';
import { emailVerificationOtpCache } from '@/lib/cache';

async function handler(request: NextRequest) {
  try {
    const body = await validateBody(request, resendVerificationSchema);
    const normalizedEmail = body.email.toLowerCase().trim();

    const user = await getUserByEmail(body.email);

    // Always return success (security: don't reveal if email exists)
    if (user && !user.email_verified) {
      const otp = generateVerificationOtp();
      emailVerificationOtpCache.set(`email_verify:${normalizedEmail}`, otp);

      try {
        await sendVerificationEmailWithOtp(user.email, otp);
      } catch (err) {
        console.error('Failed to resend verification email:', formatEmailError(err));
      }
    }

    return createSuccessResponse({
      message: 'If an account exists with this email, a verification code has been sent.',
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = handler;







