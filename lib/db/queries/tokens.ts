import { dbLogin as supabase } from '@/lib/db/client';
import { RefreshToken } from '@/lib/types/auth';
import * as crypto from 'crypto';

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

  const { data, error } = await supabase
    .from('refresh_tokens')
    .insert({
      user_id: userId,
      token: hashedToken,
      expires_at: expiresAt.toISOString(),
      device_id: deviceId,
      ip_address: ipAddress,
      user_agent: userAgent,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create refresh token: ${error.message}`);
  }

  return data as RefreshToken;
}

/**
 * Get refresh token by token value
 */
export async function getRefreshToken(token: string): Promise<RefreshToken | null> {
  const hashedToken = hashRefreshToken(token);

  const { data, error } = await supabase
    .from('refresh_tokens')
    .select('*')
    .eq('token', hashedToken)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch refresh token: ${error.message}`);
  }

  return data as RefreshToken;
}

/**
 * Revoke refresh token
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  const hashedToken = hashRefreshToken(token);

  const { error } = await supabase
    .from('refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token', hashedToken);

  if (error) {
    throw new Error(`Failed to revoke refresh token: ${error.message}`);
  }
}

/**
 * Revoke all refresh tokens for a user
 */
export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  const { error } = await supabase
    .from('refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);

  if (error) {
    throw new Error(`Failed to revoke user refresh tokens: ${error.message}`);
  }
}

/**
 * Delete expired refresh tokens (cleanup job)
 */
export async function deleteExpiredRefreshTokens(): Promise<void> {
  const { error } = await supabase
    .from('refresh_tokens')
    .delete()
    .lt('expires_at', new Date().toISOString());

  if (error) {
    throw new Error(`Failed to delete expired refresh tokens: ${error.message}`);
  }
}




