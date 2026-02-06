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
  image_urls: string[] | null;
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
        SELECT COALESCE(array_agg(elem), '{}')
        FROM jsonb_array_elements_text(COALESCE(pd.features, '[]'::jsonb)) AS elem
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
        SELECT array_agg(
          COALESCE(pi.compressed_image_url, pi.image_url)
          ORDER BY pi.is_primary DESC NULLS LAST, pi.display_order ASC, pi.image_id ASC
        )
        FROM property.PROPERTY_IMAGES pi
        WHERE pi.property_id = p.property_id
      ) AS image_urls
    FROM property.PROPERTIES p
    LEFT JOIN property.LOCATIONS l ON l.location_id = p.location_id
    LEFT JOIN master.COUNTRIES co ON co.country_id = COALESCE(l.country_id, 1)
    LEFT JOIN property.PROPERTY_DETAILS pd ON pd.property_id = p.property_id
    JOIN master.CURRENCIES c ON c.currency_id = p.currency_id
    JOIN property.PURPOSES pur ON pur.purpose_id = p.purpose_id
    JOIN property.PROPERTY_TYPES pt ON pt.type_id = p.property_type_id
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
