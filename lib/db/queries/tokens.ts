import { RefreshToken } from '@/lib/types/auth';
import * as crypto from 'crypto';
import { query, queryOne } from '@/lib/db/pg';

/**
 * Hash refresh token before storing
 */
function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create refresh token record
 */
export async function createRefreshToken(
  userId: string,
  token: string,
  expiresAt: Date,
  deviceId?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<RefreshToken> {
  const hashedToken = hashRefreshToken(token);

  const refreshToken = await queryOne<RefreshToken>(
    `INSERT INTO login.refresh_tokens (
      user_id,
      token,
      expires_at,
      device_id,
      ip_address,
      user_agent
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [
      userId,
      hashedToken,
      expiresAt.toISOString(),
      deviceId ?? null,
      ipAddress ?? null,
      userAgent ?? null,
    ]
  );

  if (!refreshToken) throw new Error('Failed to create refresh token');
  return refreshToken;
}

/**
 * Get refresh token by token value
 */
export async function getRefreshToken(token: string): Promise<RefreshToken | null> {
  const hashedToken = hashRefreshToken(token);

  const refreshToken = await queryOne<RefreshToken>(
    `SELECT *
     FROM login.refresh_tokens
     WHERE token = $1
       AND revoked_at IS NULL
       AND expires_at > (NOW() AT TIME ZONE 'UTC')`,
    [hashedToken]
  );

  return refreshToken;
}

/**
 * Revoke refresh token
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  const hashedToken = hashRefreshToken(token);

  await query(
    `UPDATE login.refresh_tokens
     SET revoked_at = $1
     WHERE token = $2`,
    [new Date().toISOString(), hashedToken]
  );
}

/**
 * Revoke all refresh tokens for a user
 */
export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await query(
    `UPDATE login.refresh_tokens
     SET revoked_at = $1
     WHERE user_id = $2 AND revoked_at IS NULL`,
    [new Date().toISOString(), userId]
  );
}

/**
 * Delete expired refresh tokens (cleanup job)
 */
export async function deleteExpiredRefreshTokens(): Promise<void> {
  await query(
    `DELETE FROM login.refresh_tokens
     WHERE expires_at < (NOW() AT TIME ZONE 'UTC')`
  );
}




