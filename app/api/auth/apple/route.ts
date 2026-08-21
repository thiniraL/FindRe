import { NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { validateBody } from '@/lib/security/validation';
import { appleLoginSchema } from '@/lib/security/validation';
import { createErrorResponse, createSuccessResponse, AppError } from '@/lib/utils/errors';
import { generateTokens } from '@/lib/auth/jwt';
import { createRefreshToken } from '@/lib/db/queries/tokens';
import { getUserByEmail, getUserById, createUser, updateUser, updateLastLogin } from '@/lib/db/queries/users';
import { getUserRole } from '@/lib/authz/permissions';
import { linkSessionToUser, createOrUpdateUserSession } from '@/lib/db/queries/sessions';
import { mergeGuestViewsIntoUser } from '@/lib/db/queries/propertyViews';
import { analyzePreferences } from '@/lib/db/queries/preferences';
import { getUserIdentityByProvider, upsertUserIdentity } from '@/lib/db/queries/identities';
import * as crypto from 'crypto';
import { User } from '@/lib/types/auth';

const APPLE_CLIENT_IDS = (process.env.APPLE_CLIENT_ID || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';
const APPLE_ISSUER = 'https://appleid.apple.com';
const appleJWKS = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

type AppleIdTokenPayload = JWTPayload & {
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
};

function isAppleTokenVerificationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const name = error.name;
  const message = error.message.toLowerCase();
  return (
    name === 'JWTExpired' ||
    name === 'JWTClaimValidationFailed' ||
    name === 'JWSSignatureVerificationFailed' ||
    name === 'JWKSNoMatchingKey' ||
    name === 'JWTInvalid' ||
    message.includes('unexpected "iss"') ||
    message.includes('unexpected "aud"') ||
    message.includes('timestamp check') ||
    message.includes('signature verification failed')
  );
}

function isEmailVerified(value: boolean | string | undefined): boolean {
  if (value === undefined) {
    // Apple omits email_verified on some tokens; treat present email as verified.
    return true;
  }
  return value === true || value === 'true';
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

async function verifyAppleIdentityToken(identityToken: string): Promise<AppleIdTokenPayload> {
  const { payload } = await jwtVerify(identityToken, appleJWKS, {
    issuer: APPLE_ISSUER,
    audience: APPLE_CLIENT_IDS,
  });
  return payload as AppleIdTokenPayload;
}

async function handler(request: NextRequest) {
  try {
    if (APPLE_CLIENT_IDS.length === 0) {
      throw new AppError('Apple client ID is not configured', 500, 'APPLE_CLIENT_ID_MISSING');
    }

    const body = await validateBody(request, appleLoginSchema);

    let payload: AppleIdTokenPayload;
    try {
      payload = await verifyAppleIdentityToken(body.identityToken);
    } catch (error) {
      if (isAppleTokenVerificationError(error)) {
        throw new AppError('Invalid Apple token', 401, 'APPLE_TOKEN_INVALID');
      }
      throw error;
    }

    if (!payload.sub) {
      throw new AppError('Apple subject is missing', 400, 'APPLE_SUB_MISSING');
    }

    const providerUserId = payload.sub;
    const tokenEmail = payload.email?.toLowerCase().trim();
    const bodyEmail = body.email?.toLowerCase().trim();

    if (tokenEmail && bodyEmail && tokenEmail !== bodyEmail) {
      throw new AppError('Apple email does not match token', 400, 'APPLE_EMAIL_MISMATCH');
    }

    if (tokenEmail && !isEmailVerified(payload.email_verified)) {
      throw new AppError('Apple email is not verified', 401, 'APPLE_EMAIL_UNVERIFIED');
    }

    const acceptLanguage = request.headers.get('accept-language') || 'en';
    const detectedLanguage = acceptLanguage.split(',')[0]?.split('-')[0] || 'en';

    const existingIdentity = await getUserIdentityByProvider('apple', providerUserId);
    let user: User;

    if (existingIdentity) {
      const identityUser = await getUserById(existingIdentity.user_id);
      if (!identityUser) {
        throw new AppError('Linked Apple user not found', 404, 'APPLE_USER_NOT_FOUND');
      }
      user = identityUser;
    } else {
      const email = tokenEmail || bodyEmail;
      if (!email) {
        throw new AppError(
          'Apple email is required on first sign-in',
          400,
          'APPLE_EMAIL_MISSING'
        );
      }

      const existingUser = await getUserByEmail(email);
      if (!existingUser) {
        const tempPassword = crypto.randomUUID();
        user = await createUser(email, tempPassword, detectedLanguage);
      } else {
        user = existingUser;
      }
    }

    if (!user.is_active) {
      throw new AppError('Account is disabled', 403, 'ACCOUNT_DISABLED');
    }

    if (!user.email_verified) {
      user = await updateUser(user.id, { email_verified: true });
    }

    const emailForIdentity = tokenEmail || bodyEmail || user.email;
    await upsertUserIdentity({
      userId: user.id,
      provider: 'apple',
      providerUserId,
      email: emailForIdentity,
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
      await mergeGuestViewsIntoUser(body.sessionId, user.id);
      await analyzePreferences(body.sessionId);
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
