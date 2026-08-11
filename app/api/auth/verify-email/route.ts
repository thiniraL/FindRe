import { NextRequest } from 'next/server';
import { verifyEmailOtp } from '@/lib/db/queries/users';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { emailVerificationSchema } from '@/lib/security/validation';

async function handler(request: NextRequest) {
  try {
    const body = await validateBody(request, emailVerificationSchema);
    const user = await verifyEmailOtp(body.email, body.otp);

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
