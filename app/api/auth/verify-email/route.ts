import { NextRequest } from 'next/server';
import { getUserByEmail, updateUser } from '@/lib/db/queries/users';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { AppError } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { emailVerificationSchema } from '@/lib/security/validation';
import { emailVerificationOtpCache } from '@/lib/cache';

async function handler(request: NextRequest) {
  try {
    const body = await validateBody(request, emailVerificationSchema);
    const normalizedEmail = body.email.toLowerCase().trim();
    const cacheKey = `email_verify:${normalizedEmail}`;

    const cachedOtp = emailVerificationOtpCache.get<string>(cacheKey);
    if (!cachedOtp || cachedOtp !== body.code) {
      throw new AppError('Invalid or expired verification code', 400, 'INVALID_VERIFICATION_CODE');
    }

    const user = await getUserByEmail(body.email);
    if (!user) {
      throw new AppError('Invalid or expired verification code', 400, 'INVALID_VERIFICATION_CODE');
    }

    await updateUser(user.id, { email_verified: true });
    emailVerificationOtpCache.delete(cacheKey);

    return createSuccessResponse({
      message: 'Email verified successfully',
      user: {
        id: user.id,
        email: user.email,
        emailVerified: true,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = handler;










