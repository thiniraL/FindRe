import { UserSession } from '@/lib/types/auth';
import { query, queryOne } from '@/lib/db/pg';

/**
 * Create or update user session (supports both authenticated and anonymous users)
 */
export async function createOrUpdateUserSession(
  sessionId: string,
  options: {
    userId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    countryCode?: string | null;
    languageCode?: string | null;
    preferredLanguageCode?: string | null;
  }
): Promise<UserSession> {
  const s = await queryOne<UserSession>(
    `INSERT INTO user_activity.user_sessions (
      session_id,
      user_id,
      ip_address,
      user_agent,
      country_code,
      language_code,
      preferred_language_code,
      last_activity_at,
      is_active
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)
    ON CONFLICT (session_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      ip_address = EXCLUDED.ip_address,
      user_agent = EXCLUDED.user_agent,
      country_code = EXCLUDED.country_code,
      language_code = EXCLUDED.language_code,
      preferred_language_code = EXCLUDED.preferred_language_code,
      last_activity_at = EXCLUDED.last_activity_at,
      is_active = TRUE
    RETURNING *`,
    [
      sessionId,
      options.userId ?? null,
      options.ipAddress ?? null,
      options.userAgent ?? null,
      options.countryCode ?? null,
      options.languageCode ?? null,
      options.preferredLanguageCode ?? null,
      new Date().toISOString(),
    ]
  );

  if (!s) throw new Error('Failed to create/update session');
  return s;
}

/**
 * Get user session by session ID
 */
export async function getUserSession(sessionId: string): Promise<UserSession | null> {
  return await queryOne<UserSession>(
    `SELECT *
     FROM user_activity.user_sessions
     WHERE session_id = $1`,
    [sessionId]
  );
}

/**
 * Link session to user (when user logs in)
 */
export async function linkSessionToUser(
  sessionId: string,
  userId: string,
  preferredLanguageCode?: string
): Promise<UserSession> {
  const updateData: Partial<
    Pick<UserSession, 'user_id' | 'last_activity_at' | 'preferred_language_code' | 'language_code'>
  > & {
    user_id: string;
    last_activity_at: string;
  } = {
    user_id: userId,
    last_activity_at: new Date().toISOString(),
  };

  // Update preferred language if provided
  if (preferredLanguageCode) {
    updateData.preferred_language_code = preferredLanguageCode;
    updateData.language_code = preferredLanguageCode;
  }

  const allowed = new Set([
    'user_id',
    'last_activity_at',
    'preferred_language_code',
    'language_code',
  ]);

  const keys = Object.keys(updateData).filter((k) => allowed.has(k));
  const sets = keys.map((k, idx) => `"${k}" = $${idx + 1}`);
  const values = keys.map((k) => (updateData as Record<string, unknown>)[k]);
  values.push(sessionId);

  const s = await queryOne<UserSession>(
    `UPDATE user_activity.user_sessions
     SET ${sets.join(', ')}
     WHERE session_id = $${values.length}
     RETURNING *`,
    values
  );

  if (!s) throw new Error('Failed to link session to user');
  return s;
}

/**
 * Update session language preference
 */
export async function updateSessionLanguagePreference(
  sessionId: string,
  languageCode: string
): Promise<UserSession> {
  const s = await queryOne<UserSession>(
    `UPDATE user_activity.user_sessions
     SET preferred_language_code = $1,
         language_code = $1,
         last_activity_at = $2
     WHERE session_id = $3
     RETURNING *`,
    [languageCode, new Date().toISOString(), sessionId]
  );

  if (!s) throw new Error('Failed to update session language');
  return s;
}

/**
 * Sync all user sessions with user's preferred language
 */
export async function syncUserSessionsLanguage(
  userId: string,
  languageCode: string
): Promise<void> {
  await query(
    `UPDATE user_activity.user_sessions
     SET preferred_language_code = $1,
         language_code = $1
     WHERE user_id = $2 AND is_active = TRUE`,
    [languageCode, userId]
  );
}

/**
 * Update session last activity
 */
export async function updateSessionActivity(sessionId: string): Promise<void> {
  try {
    await query(
      `UPDATE user_activity.user_sessions
       SET last_activity_at = $1
       WHERE session_id = $2`,
      [new Date().toISOString(), sessionId]
    );
  } catch (err) {
    // Don't throw error for activity updates - it's not critical
    console.error(
      `Failed to update session activity: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Get all active sessions for a user
 */
export async function getUserSessions(userId: string): Promise<UserSession[]> {
  return await query<UserSession>(
    `SELECT *
     FROM user_activity.user_sessions
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY last_activity_at DESC`,
    [userId]
  );
}

/**
 * Deactivate session
 */
export async function deactivateSession(sessionId: string): Promise<void> {
  await query(
    `UPDATE user_activity.user_sessions
     SET is_active = FALSE
     WHERE session_id = $1`,
    [sessionId]
  );
}

