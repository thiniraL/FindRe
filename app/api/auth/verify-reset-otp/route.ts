import { NextRequest } from 'next/server';
import { validatePasswordResetCode } from '@/lib/db/queries/users';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody, verifyPasswordResetOtpSchema } from '@/lib/security/validation';

async function handler(request: NextRequest) {
  try {
    const body = await validateBody(request, verifyPasswordResetOtpSchema);
    const user = await validatePasswordResetCode(body.email, body.otp);

    return createSuccessResponse({
      message: 'Reset code verified',
      verified: true,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = handler;
