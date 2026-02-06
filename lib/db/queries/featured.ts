import { query } from '@/lib/db/client';

export type FeaturedPropertyRow = {
  rank: number;
  property_id: number;
  title: string | null;
  description: string | null;
  price: string | number | null;
  status: string | null;
  completion_status: string | null;
  furnishing_status: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  currency_code: string | null;
  currency_symbol: string | null;
  primary_image_url: string | null;
  agent_id: number | null;
  agent_name: string | null;
  agent_profile_image_url: string | null;
  agent_profile_slug: string | null;
};

export async function countFeaturedProperties(countryId: number): Promise<number> {
  const res = await query<{ total: string }>(
    `
    SELECT COUNT(*)::text AS total
    FROM property.PROPERTIES p
    LEFT JOIN property.LOCATIONS l ON l.location_id = p.location_id
    WHERE COALESCE(l.country_id, 1) = $1
      AND p.is_featured = TRUE
    `,
    [countryId]
  );

  return parseInt(res.rows[0]?.total || '0', 10);
}

export async function getFeaturedProperties(options: {
  countryId: number;
  limit: number;
  offset: number;
  languageCode: string;
}): Promise<FeaturedPropertyRow[]> {
  const res = await query<FeaturedPropertyRow>(
    `
    SELECT
      p.property_id,
      COALESCE(p.title_translations->>$3, p.title_translations->>'en') AS title,
      COALESCE(p.description_translations->>$3, p.description_translations->>'en') AS description,
      p.price,
      p.status,
      p.completion_status,
      p.furnishing_status,
      pd.bedrooms,
      pd.bathrooms,
      c.currency_code,
      c.currency_symbol,
      img.image_url AS primary_image_url,
      a.agent_id,
      a.agent_name,
      a.profile_image_url AS agent_profile_image_url,
      a.profile_slug AS agent_profile_slug
    FROM property.PROPERTIES p
    LEFT JOIN property.LOCATIONS l ON l.location_id = p.location_id
    LEFT JOIN property.PROPERTY_DETAILS pd ON pd.property_id = p.property_id
    JOIN master.CURRENCIES c ON c.currency_id = p.currency_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(pi.compressed_image_url, pi.image_url) AS image_url
      FROM property.PROPERTY_IMAGES pi
      WHERE pi.property_id = p.property_id
      ORDER BY pi.is_primary DESC, pi.display_order ASC, pi.image_id ASC
      LIMIT 1
    ) img ON TRUE
    LEFT JOIN business.AGENTS a ON a.agent_id = p.agent_id
    WHERE COALESCE(l.country_id, 1) = $1
      AND p.is_featured = TRUE
    ORDER BY p.featured_rank ASC NULLS LAST, p.updated_at DESC
    LIMIT $2
    OFFSET $4
    `,
    [options.countryId, options.limit, options.languageCode, options.offset]
  );

  return res.rows;
}

