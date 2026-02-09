import { query } from '@/lib/db/client';

export type UpsertPropertyViewInput = {
  sessionId: string;
  userId: string | null;
  propertyId: number;
  viewedAtIso: string;
  viewDurationSeconds?: number;
  ipAddress: string;
  userAgent?: string;
  is_like?: boolean;
};

export type PropertyViewRow = {
  view_id: string | number;
  property_id: number;
  session_id: string;
  user_id: string | null;
  viewed_at: string;
  view_duration_seconds: number | null;
  ip_address: string | null;
  user_agent: string | null;
  is_liked: boolean;
  is_disliked: boolean;
  feedback_at: string;
};

function isLikeToFlags(is_like?: boolean): {
  isLiked: boolean | null;
  isDisliked: boolean | null;
} {
  if (is_like === true) return { isLiked: true, isDisliked: false };
  if (is_like === false) return { isLiked: false, isDisliked: true };
  return { isLiked: null, isDisliked: null };
}

export async function upsertPropertyView(input: UpsertPropertyViewInput): Promise<PropertyViewRow> {
  const { isLiked, isDisliked } = isLikeToFlags(input.is_like);

  // Authenticated path (uses partial unique index on (property_id, user_id) WHERE user_id IS NOT NULL)
  if (input.userId) {
    const res = await query<PropertyViewRow>(
      `
      INSERT INTO property.PROPERTY_VIEWS (
        property_id,
        session_id,
        user_id,
        viewed_at,
        view_duration_seconds,
        ip_address,
        user_agent,
        is_liked,
        is_disliked,
        feedback_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        COALESCE($8, FALSE),
        COALESCE($9, FALSE),
        CASE
          WHEN $8 IS NULL AND $9 IS NULL THEN NOW() AT TIME ZONE 'UTC'
          ELSE NOW() AT TIME ZONE 'UTC'
        END
      )
      ON CONFLICT (property_id, user_id)
        WHERE user_id IS NOT NULL
      DO UPDATE SET
        session_id = EXCLUDED.session_id,
        viewed_at = EXCLUDED.viewed_at,
        view_duration_seconds = COALESCE(EXCLUDED.view_duration_seconds, property.PROPERTY_VIEWS.view_duration_seconds),
        ip_address = EXCLUDED.ip_address,
        user_agent = EXCLUDED.user_agent,
        is_liked = COALESCE($8, property.PROPERTY_VIEWS.is_liked),
        is_disliked = COALESCE($9, property.PROPERTY_VIEWS.is_disliked),
        feedback_at = CASE
          WHEN $8 IS NULL AND $9 IS NULL THEN property.PROPERTY_VIEWS.feedback_at
          ELSE NOW() AT TIME ZONE 'UTC'
        END
      RETURNING *
      `,
      [
        input.propertyId,
        input.sessionId,
        input.userId,
        input.viewedAtIso,
        input.viewDurationSeconds ?? null,
        input.ipAddress,
        input.userAgent ?? null,
        isLiked,
        isDisliked,
      ]
    );

    return res.rows[0];
  }

  // Anonymous path (uses partial unique index on (property_id, session_id) WHERE user_id IS NULL)
  const res = await query<PropertyViewRow>(
    `
    INSERT INTO property.PROPERTY_VIEWS (
      property_id,
      session_id,
      user_id,
      viewed_at,
      view_duration_seconds,
      ip_address,
      user_agent,
      is_liked,
      is_disliked,
      feedback_at
    ) VALUES (
      $1, $2, NULL, $3, $4, $5, $6,
      COALESCE($7, FALSE),
      COALESCE($8, FALSE),
      CASE
        WHEN $7 IS NULL AND $8 IS NULL THEN NOW() AT TIME ZONE 'UTC'
        ELSE NOW() AT TIME ZONE 'UTC'
      END
    )
    ON CONFLICT (property_id, session_id)
      WHERE user_id IS NULL
    DO UPDATE SET
      viewed_at = EXCLUDED.viewed_at,
      view_duration_seconds = COALESCE(EXCLUDED.view_duration_seconds, property.PROPERTY_VIEWS.view_duration_seconds),
      ip_address = EXCLUDED.ip_address,
      user_agent = EXCLUDED.user_agent,
      is_liked = COALESCE($7, property.PROPERTY_VIEWS.is_liked),
      is_disliked = COALESCE($8, property.PROPERTY_VIEWS.is_disliked),
      feedback_at = CASE
        WHEN $7 IS NULL AND $8 IS NULL THEN property.PROPERTY_VIEWS.feedback_at
        ELSE NOW() AT TIME ZONE 'UTC'
      END
    RETURNING *
    `,
    [
      input.propertyId,
      input.sessionId,
      input.viewedAtIso,
      input.viewDurationSeconds ?? null,
      input.ipAddress,
      input.userAgent ?? null,
      isLiked,
      isDisliked,
    ]
  );

  return res.rows[0];
}

export async function countSessionViews(sessionId: string): Promise<number> {
  const res = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM property.PROPERTY_VIEWS WHERE session_id = $1`,
    [sessionId]
  );
  return parseInt(res.rows[0]?.c || '0', 10);
}


export async function getPropertyViewStatus(
  propertyIds: number[],
  sessionId: string,
  userId?: string | null
): Promise<Map<number, { isLiked: boolean; isDisliked: boolean }>> {
  if (!propertyIds.length) return new Map();

  let rows: { property_id: number; is_liked: boolean; is_disliked: boolean }[];

  if (userId) {
    const res = await query<{
      property_id: number;
      is_liked: boolean;
      is_disliked: boolean;
    }>(
      `
      SELECT property_id, is_liked, is_disliked
      FROM property.PROPERTY_VIEWS
      WHERE user_id = $1
        AND property_id = ANY($2)
      `,
      [userId, propertyIds]
    );
    rows = res.rows;
  } else {
    const res = await query<{
      property_id: number;
      is_liked: boolean;
      is_disliked: boolean;
    }>(
      `
      SELECT property_id, is_liked, is_disliked
      FROM property.PROPERTY_VIEWS
      WHERE session_id = $1
        AND user_id IS NULL
        AND property_id = ANY($2)
      `,
      [sessionId, propertyIds]
    );
    rows = res.rows;
  }

  const map = new Map<number, { isLiked: boolean; isDisliked: boolean }>();
  for (const row of rows) {
    map.set(row.property_id, {
      isLiked: row.is_liked,
      isDisliked: row.is_disliked,
    });
  }
  return map;
}

/**
 * Get paginated list of property IDs the user/session has liked (favourites),
 * ordered by most recently liked first (feedback_at DESC).
 * Uses user_id when provided, otherwise session_id with user_id IS NULL.
 */
export async function getLikedPropertyIds(
  sessionId: string,
  userId: string | null,
  limit: number,
  offset: number
): Promise<{ propertyIds: number[]; total: number }> {
  if (userId) {
    const countRes = await query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
      FROM property.PROPERTY_VIEWS
      WHERE user_id = $1 AND is_liked = TRUE
      `,
      [userId]
    );
    const total = parseInt(countRes.rows[0]?.c ?? '0', 10);
    const idRes = await query<{ property_id: number }>(
      `
      SELECT property_id
      FROM property.PROPERTY_VIEWS
      WHERE user_id = $1 AND is_liked = TRUE
      ORDER BY feedback_at DESC NULLS LAST, viewed_at DESC
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset]
    );
    return { propertyIds: idRes.rows.map((r) => r.property_id), total };
  }

  const countRes = await query<{ c: string }>(
    `
    SELECT COUNT(*)::text AS c
    FROM property.PROPERTY_VIEWS
    WHERE session_id = $1 AND user_id IS NULL AND is_liked = TRUE
    `,
    [sessionId]
  );
  const total = parseInt(countRes.rows[0]?.c ?? '0', 10);
  const idRes = await query<{ property_id: number }>(
    `
    SELECT property_id
    FROM property.PROPERTY_VIEWS
    WHERE session_id = $1 AND user_id IS NULL AND is_liked = TRUE
    ORDER BY feedback_at DESC NULLS LAST, viewed_at DESC
    LIMIT $2 OFFSET $3
    `,
    [sessionId, limit, offset]
  );
  return { propertyIds: idRes.rows.map((r) => r.property_id), total };
}

export async function bumpSessionActivityAndViews(sessionId: string): Promise<void> {
  await query(
    `
    UPDATE user_activity.USER_SESSIONS
    SET last_activity_at = NOW() AT TIME ZONE 'UTC',
        total_views = total_views + 1,
        updated_at = NOW() AT TIME ZONE 'UTC'
    WHERE session_id = $1
    `,
    [sessionId]
  );
}


