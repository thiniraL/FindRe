import jwt from 'jsonwebtoken';
import { JWTPayload, AuthTokens } from '@/lib/types/auth';
import { nanoid } from 'nanoid';

const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';

export type { JWTPayload };

function getRequiredSecret(envKey: 'JWT_SECRET' | 'JWT_REFRESH_SECRET'): string {
  const value = process.env[envKey];
  if (value && value.length >= 32) return value;

  // Keep dev experience smooth while still enforcing in production.
  if (process.env.NODE_ENV !== 'production') {
    return `${envKey}-dev-secret-please-set-env-32chars-min`;
  }

  throw new Error(`${envKey} must be at least 32 characters long`);
}

/**
 * Generate access token (short-lived)
 */
export function generateAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  const secret = getRequiredSecret('JWT_SECRET');
  return jwt.sign(payload, secret, {
    expiresIn: getExpirationTime(JWT_ACCESS_EXPIRY),
    issuer: 'findre-backend',
    audience: 'findre-client',
  });
}

/**
 * Generate refresh token (long-lived, stored in DB)
 */
export function generateRefreshToken(): string {
  return nanoid(32);
}

/**
 * Verify and decode access token
 */
export function verifyAccessToken(token: string): JWTPayload {
  try {
    const secret = getRequiredSecret('JWT_SECRET');
    const decoded = jwt.verify(token, secret, {
      issuer: 'findre-backend',
      audience: 'findre-client',
    });

    if (typeof decoded === 'string' || !decoded || typeof decoded !== 'object') {
      throw new Error('Invalid token');
    }

    const payload = decoded as Record<string, unknown>;
    if (
      typeof payload.userId !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.role !== 'string'
    ) {
      throw new Error('Invalid token');
    }

    return payload as unknown as JWTPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw error;
  }
}

/**
 * Calculate expiration time in seconds
 */
function getExpirationTime(expiry: string): number {
  if (/^\d+$/.test(expiry)) {
    return parseInt(expiry, 10);
  }
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) {
    return 15 * 60; // Default 15 minutes
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 60 * 60;
    case 'd':
      return value * 24 * 60 * 60;
    default:
      return 15 * 60;
  }
}

/**
 * Generate both access and refresh tokens
 */
export function generateTokens(
  userId: string,
  email: string,
  role: string
): AuthTokens {
  const accessToken = generateAccessToken({ userId, email, role });
  const refreshToken = generateRefreshToken();

  return {
    accessToken,
    refreshToken,
    expiresIn: getExpirationTime(JWT_ACCESS_EXPIRY),
  };
}

