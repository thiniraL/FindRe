import { getSupabaseClient } from '@/lib/db/client';
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
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('refresh_tokens')
    .insert({
      user_id: userId,
      token,
      expires_at: expiresAt.toISOString(),
      device_id: deviceId || null,
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create refresh token: ${error.message}`);
  }

  return data as RefreshToken;
}

/**
 * Get refresh token record
 */
export async function getRefreshToken(token: string): Promise<RefreshToken | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('refresh_tokens')
    .select('*')
    .eq('token', token)
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
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token', token);

  if (error) {
    throw new Error(`Failed to revoke refresh token: ${error.message}`);
  }
}

/**
 * Revoke all refresh tokens for a user
 */
export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);

  if (error) {
    throw new Error(`Failed to revoke user refresh tokens: ${error.message}`);
  }
}
