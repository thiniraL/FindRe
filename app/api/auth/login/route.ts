import { NextRequest } from 'next/server';
import { getUserByEmail } from '@/lib/db/queries/users';
import { verifyPassword } from '@/lib/auth/password';
import { generateTokens } from '@/lib/auth/jwt';
import { createRefreshToken } from '@/lib/db/queries/tokens';
import { updateLastLogin } from '@/lib/db/queries/users';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { loginSchema } from '@/lib/security/validation';
import { withRateLimit, rateLimits } from '@/lib/security/rate-limit';
import { getUserRole } from '@/lib/authz/permissions';
import { AppError } from '@/lib/utils/errors';
import { linkSessionToUser, createOrUpdateUserSession } from '@/lib/db/queries/sessions';
import * as crypto from 'crypto';

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
    const body = await validateBody(request, loginSchema);

    // Get user with password hash
    const user = await getUserByEmail(body.email);
    if (!user) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    // Check if user is active
    if (!user.is_active) {
      throw new AppError('Account is disabled', 403, 'ACCOUNT_DISABLED');
    }

    // Verify password
    const isValid = await verifyPassword(user.password_hash, body.password);
    if (!isValid) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    // Get user role
    const role = await getUserRole(user.id);
    const roleName = role?.name || 'buyer';

    // Generate tokens
    const tokens = generateTokens(user.id, user.email, roleName);

    // Revoke all existing refresh tokens (optional: for security)
    // await revokeAllUserRefreshTokens(user.id);

    // Store refresh token
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0] ||
                     request.headers.get('x-real-ip') ||
                     'unknown';
    const userAgent = request.headers.get('user-agent') || undefined;

    await createRefreshToken(
      user.id,
      tokens.refreshToken,
      getRefreshExpiry(),
      body.deviceId,
      ipAddress,
      userAgent
    );

    // Update last login
    await updateLastLogin(user.id);

    // Handle USER_SESSIONS - link session to user if sessionId provided
    if (body.sessionId) {
      await linkSessionToUser(
        body.sessionId,
        user.id,
        user.preferred_language_code || undefined
      );
    } else {
      // Create new session for authenticated user
      const sessionId = crypto.randomUUID();
      const acceptLanguage = request.headers.get('accept-language') || 'en';
      const detectedLanguage = acceptLanguage.split(',')[0]?.split('-')[0] || 'en';
      
      await createOrUpdateUserSession(sessionId, {
        userId: user.id,
        ipAddress,
        userAgent,
        languageCode: detectedLanguage,
        preferredLanguageCode: user.preferred_language_code || detectedLanguage,
      });
    }

    return createSuccessResponse({
      user: {
        id: user.id,
        email: user.email,
        emailVerified: user.email_verified,
        preferredLanguageCode: user.preferred_language_code,
      },
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

export const POST = withRateLimit(rateLimits.login)(handler);

