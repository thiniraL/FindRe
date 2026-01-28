import { getSupabaseClient } from '@/lib/db/client';

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
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_identities')
    .select('id, user_id, provider, provider_user_id, email')
    .eq('provider', provider)
    .eq('provider_user_id', providerUserId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch user identity: ${error.message}`);
  }

  return data as UserIdentity;
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
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('user_identities')
    .upsert(
      {
        user_id: userId,
        provider,
        provider_user_id: providerUserId,
        email: email || null,
      },
      { onConflict: 'provider,provider_user_id' }
    );

  if (error) {
    throw new Error(`Failed to upsert user identity: ${error.message}`);
  }
}

