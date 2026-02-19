import { query } from '@/lib/db/client';

export type PropertyDetailRow = {
  property_id: number;
  title: string | null;
  description: string | null;
  price: number | null;
  reference_number: string | null;
  status: string | null;
  furnishing_status: string | null;
  completion_status: string | null;
  is_off_plan: boolean | null;
  currency_code: string | null;
  currency_symbol: string | null;
  purpose_key: string | null;
  property_type_name: string | null;
  address_line: string | null;
  city: string | null;
  area: string | null;
  community: string | null;
  state_province: string | null;
  emirate: string | null;
  country_code: string | null;
  country_name: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqm: number | null;
  area_sqft: number | null;
  features_jsonb: string[] | null;
  agent_id: number | null;
  agent_name: string | null;
  agent_profile_image_url: string | null;
  agent_profile_slug: string | null;
  agent_email: string | null;
  agent_phone: string | null;
  agent_whatsapp: string | null;
  primary_image_url: string | null;
  /** All images in display order; each has url and is_featured (featured set max 5). */
  image_urls: string[] | null;
  /** Same order as image_urls; true when image is in the featured set. */
  image_is_featured: boolean[] | null;
};

/**
 * Get full property details by id for the detail view (location, agent, images, stats).
 * Returns null if not found.
 */
export async function getPropertyById(
  propertyId: number,
  languageCode: string = 'en'
): Promise<PropertyDetailRow | null> {
  const lang = languageCode === 'ar' ? 'ar' : 'en';
  const res = await query<PropertyDetailRow>(
    `
    SELECT
      p.property_id,
      COALESCE(p.title_translations->>$2, p.title_translations->>'en') AS title,
      COALESCE(p.description_translations->>$2, p.description_translations->>'en') AS description,
      p.price::float AS price,
      p.reference_number,
      p.status,
      p.furnishing_status,
      p.completion_status,
      p.is_off_plan,
      c.currency_code,
      c.currency_symbol,
      pur.purpose_key,
      COALESCE(pt.name_translations->>$2, pt.name_translations->>'en') AS property_type_name,
      p.address AS address_line,
      COALESCE(l.translations->$2->>'city', l.translations->'en'->>'city') AS city,
      COALESCE(l.translations->$2->>'area', l.translations->'en'->>'area') AS area,
      COALESCE(l.translations->$2->>'community', l.translations->'en'->>'community') AS community,
      l.state_province,
      l.emirate,
      co.country_code,
      COALESCE(co.name_translations->>$2, co.name_translations->>'en') AS country_name,
      pd.bedrooms,
      pd.bathrooms,
      pd.area_sqm::float AS area_sqm,
      pd.area_sqft::float AS area_sqft,
      (
        SELECT COALESCE(array_agg(f.feature_key ORDER BY f.feature_id), '{}')
        FROM unnest(COALESCE(pd.feature_ids, '{}')) AS fid
        JOIN property.FEATURES f ON f.feature_id = fid
      ) AS features_jsonb,
      a.agent_id,
      a.agent_name,
      a.profile_image_url AS agent_profile_image_url,
      a.profile_slug AS agent_profile_slug,
      a.email AS agent_email,
      a.phone AS agent_phone,
      a.whatsapp AS agent_whatsapp,
      primary_img.image_url AS primary_image_url,
      (
        SELECT array_agg(COALESCE(pi.compressed_image_url, pi.image_url) ORDER BY pi.is_primary DESC NULLS LAST, pi.display_order ASC, pi.image_id ASC)
        FROM property.PROPERTY_IMAGES pi
        WHERE pi.property_id = p.property_id
      ) AS image_urls,
      (
        SELECT array_agg(COALESCE(pi.is_featured, FALSE) ORDER BY pi.is_primary DESC NULLS LAST, pi.display_order ASC, pi.image_id ASC)
        FROM property.PROPERTY_IMAGES pi
        WHERE pi.property_id = p.property_id
      ) AS image_is_featured
    FROM property.PROPERTIES p
    LEFT JOIN property.LOCATIONS l ON l.location_id = p.location_id
    LEFT JOIN master.COUNTRIES co ON co.country_id = COALESCE(l.country_id, 1)
    LEFT JOIN property.PROPERTY_DETAILS pd ON pd.property_id = p.property_id
    JOIN master.CURRENCIES c ON c.currency_id = p.currency_id
    JOIN property.PURPOSES pur ON pur.purpose_id = p.purpose_id
    LEFT JOIN property.PROPERTY_TYPES pt ON cardinality(p.property_type_ids) > 0 AND pt.type_id = (p.property_type_ids)[1]
    LEFT JOIN business.AGENTS a ON a.agent_id = p.agent_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(pi.compressed_image_url, pi.image_url) AS image_url
      FROM property.PROPERTY_IMAGES pi
      WHERE pi.property_id = p.property_id
      ORDER BY pi.is_primary DESC NULLS LAST, pi.display_order ASC, pi.image_id ASC
      LIMIT 1
    ) primary_img ON TRUE
    WHERE p.property_id = $1
    `,
    [propertyId, lang]
  );
  return res.rows[0] ?? null;
}

export type PropertyImagesRow = {
  property_id: number;
  primary_image_url: string | null;
  image_urls: string[];
  image_is_featured: boolean[];
};

/**
 * Get all images (and is_featured) for multiple properties. Used to enrich search results with full image lists.
 * Returns a Map by property_id; each value has primary_image_url and ordered image_urls + image_is_featured.
 */
export async function getPropertyImagesBulk(
  propertyIds: number[]
): Promise<Map<number, PropertyImagesRow>> {
  if (!propertyIds.length) return new Map();
  const res = await query<{
    property_id: number;
    primary_image_url: string | null;
    image_urls: string[];
    image_is_featured: boolean[];
  }>(
    `
    WITH ids AS (SELECT unnest($1::int[]) AS property_id),
         ordered AS (
           SELECT pi.property_id,
                  COALESCE(pi.compressed_image_url, pi.image_url) AS url,
                  COALESCE(pi.is_featured, FALSE) AS is_featured
           FROM property.PROPERTY_IMAGES pi
           JOIN ids i ON i.property_id = pi.property_id
           ORDER BY pi.property_id, pi.is_primary DESC NULLS LAST, pi.display_order ASC, pi.image_id ASC
         ),
         agg AS (
           SELECT property_id,
                  (array_agg(url))[1] AS primary_image_url,
                  array_agg(url) AS image_urls,
                  array_agg(is_featured) AS image_is_featured
           FROM ordered
           GROUP BY property_id
         )
    SELECT a.property_id,
           a.primary_image_url,
           COALESCE(a.image_urls, '{}') AS image_urls,
           COALESCE(a.image_is_featured, '{}') AS image_is_featured
    FROM agg a
    `,
    [propertyIds]
  );
  const map = new Map<number, PropertyImagesRow>();
  for (const row of res.rows) {
    map.set(row.property_id, {
      property_id: row.property_id,
      primary_image_url: row.primary_image_url,
      image_urls: row.image_urls ?? [],
      image_is_featured: row.image_is_featured ?? [],
    });
  }
  return map;
}
