import { NextRequest } from 'next/server';
import { createUserWithVerificationToken } from '@/lib/db/queries/users';
import { generateTokens } from '@/lib/auth/jwt';
import { createRefreshToken } from '@/lib/db/queries/tokens';
import { assignRoleToUser, getRoleByName } from '@/lib/db/queries/roles';
import { sendVerificationEmail } from '@/lib/email/send';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { registerSchema } from '@/lib/security/validation';
import { withRateLimit, rateLimits } from '@/lib/security/rate-limit';
import { getUserRole } from '@/lib/authz/permissions';
import { createOrUpdateUserSession, linkSessionToUser } from '@/lib/db/queries/sessions';
import * as crypto from 'crypto';

const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

function getRefreshExpiry(): Date {
  const match = JWT_REFRESH_EXPIRY.match(/^(\d+)([smhd])$/);
  if (!match) {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default 7 days
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
    const body = await validateBody(request, registerSchema);

    // Get client info
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0] ||
                     request.headers.get('x-real-ip') ||
                     'unknown';
    const userAgent = request.headers.get('user-agent') || undefined;
    const acceptLanguage = request.headers.get('accept-language') || 'en';
    const detectedLanguage = acceptLanguage.split(',')[0]?.split('-')[0] || 'en';

    // Determine preferred language
    const preferredLanguageCode = body.preferredLanguageCode || detectedLanguage || 'en';

    // Create user with language preference
    const { user, emailVerificationToken } = await createUserWithVerificationToken(
      body.email,
      body.password,
      preferredLanguageCode
    );

    try {
      await sendVerificationEmail(user.email, emailVerificationToken);
    } catch (err) {
      // Don't fail registration if email provider is down
      console.error('Failed to send verification email:', err);
    }

    // Assign default role (buyer)
    const defaultRole = await getRoleByName('buyer');
    if (defaultRole) {
      await assignRoleToUser(user.id, defaultRole.id);
    }

    // Get user role
    const role = await getUserRole(user.id);
    const roleName = role?.name || 'buyer';

    // Generate tokens
    const tokens = generateTokens(user.id, user.email, roleName);

    // Store refresh token
    await createRefreshToken(
      user.id,
      tokens.refreshToken,
      getRefreshExpiry(),
      body.deviceId,
      ipAddress,
      userAgent
    );

    // Handle USER_SESSIONS - link session to user if sessionId provided
    if (body.sessionId) {
      await linkSessionToUser(body.sessionId, user.id, preferredLanguageCode);
    } else {
      // Create new session for authenticated user
      const sessionId = crypto.randomUUID();
      await createOrUpdateUserSession(sessionId, {
        userId: user.id,
        ipAddress,
        userAgent,
        languageCode: detectedLanguage,
        preferredLanguageCode,
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
    }, 201);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = withRateLimit(rateLimits.register)(handler);

