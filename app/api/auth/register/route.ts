import { NextRequest } from 'next/server';
import { createUserWithVerificationToken, getUserByEmail } from '@/lib/db/queries/users';
import { generateTokens } from '@/lib/auth/jwt';
import { createRefreshToken } from '@/lib/db/queries/tokens';
import { assignRoleToUser, getRoleByName } from '@/lib/db/queries/roles';
import { sendVerificationEmailWithOtp } from '@/lib/email/send';
import { AppError, createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { registerSchema } from '@/lib/security/validation';
import { createOrUpdateUserSession, linkSessionToUser } from '@/lib/db/queries/sessions';
import { roleCache, emailVerificationOtpCache } from '@/lib/cache';
import type { Role } from '@/lib/types/auth';
import { generateVerificationOtp } from '@/lib/auth/password';
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

    // Fail fast if email already exists (avoid expensive password hash)
    const existingUser = await getUserByEmail(body.email);
    if (existingUser) {
      return createErrorResponse(new AppError('Email already exists', 409, 'EMAIL_ALREADY_EXISTS'));
    }

    // Create user with language preference
    const { user } = await createUserWithVerificationToken(
      body.email,
      body.password,
      preferredLanguageCode
    );

    // Send 6-digit OTP only (no link) in background
    const normalizedEmail = body.email.toLowerCase().trim();
    const otp = generateVerificationOtp();
    emailVerificationOtpCache.set(`email_verify:${normalizedEmail}`, otp);
    sendVerificationEmailWithOtp(user.email, otp).catch((err) => {
      console.error('Failed to send verification email:', err);
    });

    // Assign default role (buyer) - use cache to avoid DB hit on every registration
    let defaultRole = roleCache.get<Role>('buyer');
    if (!defaultRole) {
      defaultRole = await getRoleByName('buyer');
      if (defaultRole) roleCache.set('buyer', defaultRole);
    }
    if (defaultRole) {
      await assignRoleToUser(user.id, defaultRole.id);
    }

    // We just assigned buyer; use it for tokens (skip getUserRole DB call)
    const tokens = generateTokens(user.id, user.email, 'buyer');

    const sessionPromise = body.sessionId
      ? linkSessionToUser(body.sessionId, user.id, preferredLanguageCode)
      : (() => {
          const sessionId = crypto.randomUUID();
          return createOrUpdateUserSession(sessionId, {
            userId: user.id,
            ipAddress,
            userAgent,
            languageCode: detectedLanguage,
            preferredLanguageCode,
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
    }, 201);
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = handler;

