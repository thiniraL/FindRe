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
  agency_id: number | null;
  agency_name: string | null;
  agency_logo_url: string | null;
  primary_image_url: string | null;
  /**
   * Images with shared displayOrder (mixed with videos on the admin Media tab).
   * Featured set is up to 5 mixed image/video items.
   */
  images_json: PropertyImageJson[] | null;
  /** Videos from property.property_videos (url, displayOrder, durationSeconds, isFeatured). */
  videos_json: PropertyVideoJson[] | null;
};

export type PropertyImageJson = {
  url: string;
  displayOrder: number | null;
  isFeatured: boolean;
};

export type PropertyVideoJson = {
  url: string;
  displayOrder: number | null;
  durationSeconds: number | null;
  /** Present when property.property_videos.is_featured exists. */
  isFeatured?: boolean;
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
      ag.agency_id,
      COALESCE(ag.translations->$2->>'name', ag.translations->'en'->>'name') AS agency_name,
      ag.logo_url AS agency_logo_url,
      primary_img.image_url AS primary_image_url,
      (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'url', COALESCE(pi.compressed_image_url, pi.image_url),
              'displayOrder', pi.display_order,
              'isFeatured', COALESCE(pi.is_featured, FALSE)
            )
            ORDER BY pi.display_order ASC NULLS LAST, pi.image_id ASC
          ),
          '[]'::json
        )
        FROM property.PROPERTY_IMAGES pi
        WHERE pi.property_id = p.property_id
      ) AS images_json,
      (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'url', pv.video_url,
              'displayOrder', pv.display_order,
              'durationSeconds', pv.duration_seconds,
              'isFeatured', COALESCE(pv.is_featured, FALSE)
            )
            ORDER BY pv.display_order ASC NULLS LAST, pv.video_id ASC
          ),
          '[]'::json
        )
        FROM property.property_videos pv
        WHERE pv.property_id = p.property_id
      ) AS videos_json
    FROM property.PROPERTIES p
    LEFT JOIN property.LOCATIONS l ON l.location_id = p.location_id
    LEFT JOIN master.COUNTRIES co ON co.country_id = COALESCE(l.country_id, 1)
    LEFT JOIN property.PROPERTY_DETAILS pd ON pd.property_id = p.property_id
    JOIN master.CURRENCIES c ON c.currency_id = p.currency_id
    JOIN property.PURPOSES pur ON pur.purpose_id = p.purpose_id
    LEFT JOIN property.PROPERTY_TYPES pt ON cardinality(p.property_type_ids) > 0 AND pt.type_id = (p.property_type_ids)[1]
    LEFT JOIN business.AGENTS a ON a.agent_id = p.agent_id
    LEFT JOIN business.AGENCIES ag ON ag.agency_id = a.agency_id
    LEFT JOIN LATERAL (
      -- First featured image by shared display_order (fallback: any image by display_order).
      SELECT COALESCE(pi.compressed_image_url, pi.image_url) AS image_url
      FROM property.PROPERTY_IMAGES pi
      WHERE pi.property_id = p.property_id
      ORDER BY COALESCE(pi.is_featured, FALSE) DESC, pi.display_order ASC NULLS LAST, pi.image_id ASC
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
