import { NextRequest } from 'next/server';
import { verifyUserEmail } from '@/lib/db/queries/users';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { emailVerificationSchema } from '@/lib/security/validation';
import { withRateLimit, rateLimits } from '@/lib/security/rate-limit';

async function handler(request: NextRequest) {
  try {
    const body = await validateBody(request, emailVerificationSchema);

    const user = await verifyUserEmail(body.token);

    return createSuccessResponse({
      message: 'Email verified successfully',
      user: {
        id: user.id,
        email: user.email,
        emailVerified: user.email_verified,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = withRateLimit(rateLimits.auth)(handler);










