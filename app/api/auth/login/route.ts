import { NextRequest } from 'next/server';
import { getUserByEmail } from '@/lib/db/queries/users';
import { verifyPassword } from '@/lib/auth/password';
import { generateTokens } from '@/lib/auth/jwt';
import { createRefreshToken } from '@/lib/db/queries/tokens';
import { updateLastLogin } from '@/lib/db/queries/users';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { loginSchema } from '@/lib/security/validation';
import { getUserRole } from '@/lib/authz/permissions';
import { roleNameCache } from '@/lib/authz/cache';
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

    // Require verified email before issuing tokens
    if (!user.email_verified) {
      return createSuccessResponse({
        emailVerificationRequired: true,
        message: 'Please verify your email to sign in.',
        user: {
          id: user.id,
          email: user.email,
          emailVerified: false,
        },
      });
    }

    // Get user role (cached to avoid DB on repeat logins)
    const roleNameKey = `user:${user.id}:rolename`;
    let roleName = roleNameCache.get<string>(roleNameKey);
    if (roleName == null) {
      const role = await getUserRole(user.id);
      roleName = role?.name || 'buyer';
      roleNameCache.set(roleNameKey, roleName);
    }

    // Generate tokens
    const tokens = generateTokens(user.id, user.email, roleName);

    // Revoke all existing refresh tokens (optional: for security)
    // await revokeAllUserRefreshTokens(user.id);

    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0] ||
                     request.headers.get('x-real-ip') ||
                     'unknown';
    const userAgent = request.headers.get('user-agent') || undefined;

    const sessionPromise = body.sessionId
      ? linkSessionToUser(
          body.sessionId,
          user.id,
          user.preferred_language_code || undefined
        )
      : (() => {
          const sessionId = crypto.randomUUID();
          const acceptLanguage = request.headers.get('accept-language') || 'en';
          const detectedLanguage = acceptLanguage.split(',')[0]?.split('-')[0] || 'en';
          return createOrUpdateUserSession(sessionId, {
            userId: user.id,
            ipAddress,
            userAgent,
            languageCode: detectedLanguage,
            preferredLanguageCode: user.preferred_language_code || detectedLanguage,
          });
        })();

    await Promise.all([
      createRefreshToken(
        user.id,
        tokens.refreshToken,
        getRefreshExpiry(),
        body.deviceId,
        ipAddress,
        userAgent
      ),
      updateLastLogin(user.id),
      sessionPromise,
    ]);

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

export const POST = handler;

