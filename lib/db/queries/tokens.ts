import { query } from '@/lib/db/client';
import { RefreshToken } from '@/lib/types/auth';

/**
 * Create refresh token
 */
export async function createRefreshToken(
  userId: string,
  token: string,
  expiresAt: Date,
  deviceId?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<RefreshToken> {
  const result = await query<RefreshToken>(
    `INSERT INTO login.refresh_tokens
     (user_id, token, expires_at, device_id, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      userId,
      token,
      expiresAt.toISOString(),
      deviceId || null,
      ipAddress || null,
      userAgent || null,
    ]
  );

  return result.rows[0];
}

/**
 * Get refresh token record
 */
export async function getRefreshToken(token: string): Promise<RefreshToken | null> {
  const result = await query<RefreshToken>(
    `SELECT *
     FROM login.refresh_tokens
     WHERE token = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()`,
    [token]
  );

  return result.rows[0] || null;
}

/**
 * Revoke refresh token
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  await query(
    `UPDATE login.refresh_tokens
     SET revoked_at = NOW()
     WHERE token = $1`,
    [token]
  );
}

/**
 * Revoke all refresh tokens for a user
 */
export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await query(
    `UPDATE login.refresh_tokens
     SET revoked_at = NOW()
     WHERE user_id = $1
       AND revoked_at IS NULL`,
    [userId]
  );
}
