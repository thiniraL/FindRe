import { NextRequest } from 'next/server';
import { getRefreshToken, revokeRefreshToken, createRefreshToken } from '@/lib/db/queries/tokens';
import { getUserById } from '@/lib/db/queries/users';
import { generateTokens } from '@/lib/auth/jwt';
import { createErrorResponse, createSuccessResponse, AppError } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { refreshTokenSchema } from '@/lib/security/validation';
import { getUserRole } from '@/lib/authz/permissions';

const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

function getRefreshExpiry(): Date {
  const match = JWT_REFRESH_EXPIRY.match(/^(\d+)([smhd])$/);
  if (!match) {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];
  let ms = value * 1000;

  switch (unit) {
    case 'm':
      ms *= 60;
      break;
    case 'h':
      ms *= 60 * 60;
      break;
    case 'd':
      ms *= 24 * 60 * 60;
      break;
  }

  return new Date(Date.now() + ms);
}

async function handler(request: NextRequest) {
  try {
    const body = await validateBody(request, refreshTokenSchema);

    // Get refresh token
    const refreshTokenRecord = await getRefreshToken(body.refreshToken);
    if (!refreshTokenRecord) {
      throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    // Get user
    const user = await getUserById(refreshTokenRecord.user_id);
    if (!user || !user.is_active) {
      throw new AppError('User not found or inactive', 401, 'USER_INACTIVE');
    }

    // Revoke old refresh token (token rotation)
    await revokeRefreshToken(body.refreshToken);

    // Get user role
    const role = await getUserRole(user.id);
    const roleName = role?.name || 'buyer';

    // Generate new tokens
    const tokens = generateTokens(user.id, user.email, roleName);

    // Store new refresh token
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0] ||
                     request.headers.get('x-real-ip') ||
                     'unknown';
    const userAgent = request.headers.get('user-agent') || undefined;

    await createRefreshToken(
      user.id,
      tokens.refreshToken,
      getRefreshExpiry(),
      refreshTokenRecord.device_id || undefined,
      ipAddress,
      userAgent
    );

    return createSuccessResponse({
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = handler;

