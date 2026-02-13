import { NextRequest } from 'next/server';
import { revokeRefreshToken } from '@/lib/db/queries/tokens';
import { createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { refreshTokenSchema } from '@/lib/security/validation';
async function handler(request: NextRequest) {
  try {
    const body = await validateBody(request, refreshTokenSchema);

    // Revoke refresh token
    await revokeRefreshToken(body.refreshToken);

    return createSuccessResponse({ message: 'Logged out successfully' });
  } catch {
    // Even if token is invalid, return success for security
    return createSuccessResponse({ message: 'Logged out successfully' });
  }
}

export const POST = handler;




