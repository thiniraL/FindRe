import { query } from '@/lib/db/client';

export type UserIdentityInput = {
  userId: string;
  provider: string;
  providerUserId: string;
  email?: string | null;
};

export type UserIdentity = {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  email: string | null;
};

/**
 * Get identity by provider + provider user id.
 */
export async function getUserIdentityByProvider(
  provider: string,
  providerUserId: string
): Promise<UserIdentity | null> {
  const result = await query<UserIdentity>(
    `SELECT id, user_id, provider, provider_user_id, email
     FROM login.user_identities
     WHERE provider = $1
       AND provider_user_id = $2`,
    [provider, providerUserId]
  );

  return result.rows[0] || null;
}

/**
 * Upsert external identity link for a user.
 */
export async function upsertUserIdentity({
  userId,
  provider,
  providerUserId,
  email,
}: UserIdentityInput): Promise<void> {
  await query(
    `INSERT INTO login.user_identities (user_id, provider, provider_user_id, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (provider, provider_user_id)
     DO UPDATE SET user_id = EXCLUDED.user_id,
                   email = EXCLUDED.email`,
    [userId, provider, providerUserId, email || null]
  );
}

