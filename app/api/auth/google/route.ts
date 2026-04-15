import { NextRequest } from 'next/server';
import { OAuth2Client, LoginTicket } from 'google-auth-library';
import { validateBody } from '@/lib/security/validation';
import { googleLoginSchema } from '@/lib/security/validation';
import { createErrorResponse, createSuccessResponse, AppError } from '@/lib/utils/errors';
import { generateTokens } from '@/lib/auth/jwt';
import { createRefreshToken } from '@/lib/db/queries/tokens';
import { getUserByEmail, createUser, updateUser, updateLastLogin } from '@/lib/db/queries/users';
import { getUserRole } from '@/lib/authz/permissions';
import { linkSessionToUser, createOrUpdateUserSession } from '@/lib/db/queries/sessions';
import { getUserIdentityByProvider, upsertUserIdentity } from '@/lib/db/queries/identities';
import * as crypto from 'crypto';
import { User } from '@/lib/types/auth';

const GOOGLE_CLIENT_IDS = (process.env.GOOGLE_CLIENT_ID || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

function isGoogleTokenVerificationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  // google-auth-library throws regular Error instances for verification failures.
  const message = error.message.toLowerCase();
  return (
    message.includes('wrong recipient') ||
    message.includes('jwt audience invalid') ||
    message.includes('token used too late') ||
    message.includes('token used too early') ||
    message.includes('token expired') ||
    message.includes('invalid token signature') ||
    message.includes('no pem found') ||
    message.includes('failed to verify')
  );
}

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
    if (GOOGLE_CLIENT_IDS.length === 0) {
      throw new AppError('Google client ID is not configured', 500, 'GOOGLE_CLIENT_ID_MISSING');
    }

    const body = await validateBody(request, googleLoginSchema);
    const client = new OAuth2Client();
    let ticket: LoginTicket;
    try {
      ticket = await client.verifyIdToken({
        idToken: body.idToken,
        audience: GOOGLE_CLIENT_IDS,
      });
    } catch (error) {
      if (isGoogleTokenVerificationError(error)) {
        throw new AppError('Invalid Google token', 401, 'GOOGLE_TOKEN_INVALID');
      }
      throw error;
    }

    const payload = ticket.getPayload();
    if (!payload?.email) {
      throw new AppError('Google account has no email', 400, 'GOOGLE_EMAIL_MISSING');
    }
    if (!payload.email_verified) {
      throw new AppError('Google email is not verified', 401, 'GOOGLE_EMAIL_UNVERIFIED');
    }
    if (!payload.sub) {
      throw new AppError('Google subject is missing', 400, 'GOOGLE_SUB_MISSING');
    }

    const email = payload.email.toLowerCase().trim();
    const providerUserId = payload.sub;

    const acceptLanguage = request.headers.get('accept-language') || 'en';
    const detectedLanguage = acceptLanguage.split(',')[0]?.split('-')[0] || 'en';

    const existingUser = await getUserByEmail(email);
    let user: User;
    if (!existingUser) {
      const tempPassword = crypto.randomUUID();
      user = await createUser(email, tempPassword, detectedLanguage);
    } else {
      user = existingUser;
    }

    if (!user.is_active) {
      throw new AppError('Account is disabled', 403, 'ACCOUNT_DISABLED');
    }

    if (!user.email_verified) {
      user = await updateUser(user.id, { email_verified: true });
    }

    const existingIdentity = await getUserIdentityByProvider('google', providerUserId);
    if (existingIdentity && existingIdentity.user_id !== user.id) {
      throw new AppError('Google account is already linked to another user', 409, 'GOOGLE_IDENTITY_CONFLICT');
    }

    await upsertUserIdentity({
      userId: user.id,
      provider: 'google',
      providerUserId,
      email,
    });

    const role = await getUserRole(user.id);
    const roleName = role?.name || 'buyer';
    const tokens = generateTokens(user.id, user.email, roleName);

    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
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

    await updateLastLogin(user.id);

    if (body.sessionId) {
      await linkSessionToUser(
        body.sessionId,
        user.id,
        user.preferred_language_code || undefined
      );
    } else {
      const sessionId = crypto.randomUUID();
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

export const POST = handler;

