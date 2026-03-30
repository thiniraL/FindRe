import { NextRequest } from 'next/server';
import {
  createUserWithVerificationToken,
  deleteUserById,
  getUserByEmail,
} from '@/lib/db/queries/users';
import { assignRoleToUser, getRoleByName } from '@/lib/db/queries/roles';
import { sendVerificationEmailWithOtp, formatEmailError } from '@/lib/email/send';
import { AppError, createErrorResponse, createSuccessResponse } from '@/lib/utils/errors';
import { validateBody } from '@/lib/security/validation';
import { registerSchema } from '@/lib/security/validation';
import { roleCache, emailVerificationOtpCache } from '@/lib/cache';
import type { Role } from '@/lib/types/auth';
import { generateVerificationOtp } from '@/lib/auth/password';

async function handler(request: NextRequest) {
  try {
    const body = await validateBody(request, registerSchema);

    const acceptLanguage = request.headers.get('accept-language') || 'en';
    const detectedLanguage = acceptLanguage.split(',')[0]?.split('-')[0] || 'en';
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

    const normalizedEmail = body.email.toLowerCase().trim();
    const otp = generateVerificationOtp();
    const otpCacheKey = `email_verify:${normalizedEmail}`;
    emailVerificationOtpCache.set(otpCacheKey, otp);

    try {
      await sendVerificationEmailWithOtp(user.email, otp);
    } catch (err) {
      emailVerificationOtpCache.delete(otpCacheKey);
      console.error('Failed to send verification email:', formatEmailError(err));
      await deleteUserById(user.id).catch((delErr) => {
        console.error('Failed to roll back user after email failure:', delErr);
      });
      throw new AppError(
        'Could not send verification email. Check SMTP settings and try again.',
        503,
        'VERIFICATION_EMAIL_FAILED'
      );
    }

    // Assign default role (buyer) - use cache to avoid DB hit on every registration
    let defaultRole = roleCache.get<Role>('buyer');
    if (!defaultRole) {
      defaultRole = await getRoleByName('buyer');
      if (defaultRole) roleCache.set('buyer', defaultRole);
    }
    if (defaultRole) {
      await assignRoleToUser(user.id, defaultRole.id);
    }

    // Do not issue tokens until email is verified
    return createSuccessResponse(
      {
        emailVerificationRequired: true,
        message:
          'We sent a 6-digit verification code to your email. Enter it on the verify screen, then you can sign in.',
        user: {
          id: user.id,
          email: user.email,
          emailVerified: false,
          preferredLanguageCode: user.preferred_language_code,
        },
      },
      201
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}

export const POST = handler;

