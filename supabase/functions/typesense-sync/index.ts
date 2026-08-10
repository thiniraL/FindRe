// @ts-nocheck
// Supabase Edge Function: typesense-sync
// - Scheduled batch sync from Postgres -> Typesense
// - Upserts documents into `properties` collection
// - Uses a Typesense-side `sync_state` collection for watermark storage
//
// Required env vars:
// - SUPABASE_DB_URL (direct Postgres connection string)
// - TYPESENSE_HOST
// - TYPESENSE_PROTOCOL (http/https) [default: https]
// - TYPESENSE_PORT (optional)
// - TYPESENSE_API_KEY

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { Pool } from 'https://deno.land/x/postgres@v0.17.0/mod.ts';

type TypesenseField = {
  name: string;
  type: string;
  facet?: boolean;
  optional?: boolean;
  sort?: boolean;
};

type TypesenseCollectionSchema = {
  name: string;
  fields: TypesenseField[];
  default_sorting_field?: string;
};

const PROPERTIES_COLLECTION_SCHEMA: TypesenseCollectionSchema = {
  name: 'properties',
  default_sorting_field: 'updated_at',
  fields: [
    { name: 'property_id', type: 'string' },
    { name: 'country_id', type: 'int32', facet: true },
    { name: 'purpose_id', type: 'int32', facet: true, optional: true },
    { name: 'purpose_key', type: 'string', facet: true, optional: true },
    { name: 'property_type_id', type: 'int32', facet: true, optional: true },
    { name: 'property_type_ids', type: 'int32[]', facet: true, optional: true },
    { name: 'property_type_key', type: 'string', facet: true, optional: true },
    { name: 'property_type_keys', type: 'string[]', facet: true, optional: true },
    { name: 'property_type_en', type: 'string', optional: true },
    { name: 'property_type_names_en', type: 'string[]', optional: true },
    { name: 'main_property_type_ids', type: 'int32[]', facet: true, optional: true },
    { name: 'main_property_type_keys', type: 'string[]', facet: true, optional: true },
    { name: 'main_property_type_names_en', type: 'string[]', optional: true },
    { name: 'price', type: 'float', facet: true, optional: true },
    { name: 'price_str', type: 'string', optional: true },
    { name: 'currency_id', type: 'int32', facet: true, optional: true },
    { name: 'currency_code', type: 'string', facet: true, optional: true },
    { name: 'currency_en', type: 'string', optional: true },
    { name: 'currency_symbol', type: 'string', optional: true },
    { name: 'bedrooms', type: 'int32', facet: true, optional: true },
    { name: 'bedrooms_str', type: 'string', optional: true },
    { name: 'bathrooms', type: 'int32', facet: true, optional: true },
    { name: 'bathrooms_str', type: 'string', optional: true },
    { name: 'area_sqft', type: 'float', facet: true, optional: true },
    { name: 'area_sqft_str', type: 'string', optional: true },
    { name: 'area_sqm', type: 'float', facet: true, optional: true },
    { name: 'area_sqm_str', type: 'string', optional: true },
    // Location search uses address text
    { name: 'address', type: 'string', optional: true },
    // Feature IDs (filter by feature_ids); display keys in features
    { name: 'feature_ids', type: 'int32[]', facet: true, optional: true },
    { name: 'features', type: 'string[]', facet: true, optional: true },
    { name: 'agent_id', type: 'int32', facet: true, optional: true },
    { name: 'agency_id', type: 'int32', facet: true, optional: true },
    { name: 'agency_name', type: 'string', optional: true },
    { name: 'profile_image_url', type: 'string', optional: true },
    { name: 'status', type: 'string', facet: true, optional: true },
    { name: 'completion_status', type: 'string', facet: true, optional: true },
    { name: 'is_off_plan', type: 'bool', facet: true, optional: true },
    { name: 'is_featured', type: 'bool', facet: true, optional: true },
    { name: 'featured_rank', type: 'int32', optional: true },
    { name: 'created_at', type: 'int64', sort: true, optional: true },
    // Must be non-optional because it's the default_sorting_field
    { name: 'updated_at', type: 'int64', sort: true },
    { name: 'title_en', type: 'string', optional: true },
    { name: 'title_ar', type: 'string', optional: true },
    { name: 'city_en', type: 'string', optional: true },
    { name: 'area_en', type: 'string', optional: true },
    { name: 'community_en', type: 'string', optional: true },
    { name: 'agent_name', type: 'string', optional: true },
    { name: 'agent_email', type: 'string', optional: true },
    { name: 'agent_phone', type: 'string', optional: true },
    { name: 'agent_whatsapp', type: 'string', optional: true },
    { name: 'primary_image_url', type: 'string', optional: true },
    // "image" | "video" — primary can be either (first featured / first media by display_order)
    { name: 'primary_media_type', type: 'string', optional: true },
    { name: 'additional_image_urls', type: 'string[]', optional: true },
    // Parallel to additional_image_urls / all_image_urls: "image" | "video"
    { name: 'additional_media_types', type: 'string[]', optional: true },
    { name: 'all_image_urls', type: 'string[]', optional: true },
    { name: 'all_media_types', type: 'string[]', optional: true },
    { name: 'image_is_featured', type: 'int32[]', optional: true },
    { name: 'geo', type: 'geopoint', optional: true },
  ],
};

function mustGetEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v || !v.trim()) throw new Error(`Missing env: ${key}`);
  return v.trim();
}

/** String mirrors for NL query_by (Typesense query_by cannot use int/float). */
function bedroomsStr(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  if (v === 0) return '0 studio 0 bedroom 0 bedrooms 0 bed';
  return `${v} ${v} bedroom ${v} bedrooms ${v} bed`;
}

function bathroomsStr(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  return `${v} ${v} bathroom ${v} bathrooms ${v} bath`;
}

function areaSqmStr(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  const rounded = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return `${rounded} ${rounded} sqm ${rounded} square meters ${rounded} m2`;
}

function areaSqftStr(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  const rounded = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return `${rounded} ${rounded} sqft ${rounded} square feet`;
}

function priceStr(
  price: number | null | undefined,
  currencyCode: string | null | undefined
): string | null {
  if (price == null || !Number.isFinite(Number(price))) return null;
  const v = Number(price);
  const num = Number.isInteger(v) ? String(v) : String(v);
  const code = currencyCode?.trim();
  return code ? `${num} ${num} ${code}` : num;
}

function getTypesenseBaseUrl(): string {
  const host = mustGetEnv('TYPESENSE_HOST');
  const protocol = (Deno.env.get('TYPESENSE_PROTOCOL') || 'https').trim();
  const port = (Deno.env.get('TYPESENSE_PORT') || '').trim();
  return port ? `${protocol}://${host}:${port}` : `${protocol}://${host}`;
}

async function tsFetch(path: string, init?: RequestInit): Promise<Response> {
  const apiKey = mustGetEnv('TYPESENSE_API_KEY');
  const base = getTypesenseBaseUrl();
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  return await fetch(url, {
    ...init,
    headers: {
      'X-TYPESENSE-API-KEY': apiKey,
      ...(init?.headers || {}),
    },
  });
}

async function ensureCollection(schema: TypesenseCollectionSchema): Promise<void> {
  const getRes = await tsFetch(`/collections/${encodeURIComponent(schema.name)}`, {
    method: 'GET',
  });

  if (getRes.ok) {
    // Check if we need to add missing fields (auto-patching)
    const currentSchema = (await getRes.json()) as any;
    const currentFields = new Set(currentSchema.fields.map((f: any) => f.name));
    // Skip 'id' field as it's reserved and handled automatically by Typesense
    const missingFields = schema.fields.filter((f) => f.name !== 'id' && !currentFields.has(f.name));

    if (missingFields.length > 0) {
      console.log(`Patching collection ${schema.name} with missing fields:`, missingFields.map(f => f.name));
      const patchRes = await tsFetch(`/collections/${encodeURIComponent(schema.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: missingFields }),
      });
      if (!patchRes.ok) {
        const text = await patchRes.text().catch(() => '');
        throw new Error(`Typesense patch collection failed: ${schema.name} (${patchRes.status}) ${text}`);
      }
    }
    return;
  }

  if (getRes.status !== 404) {
    throw new Error(`Typesense collection check failed: ${schema.name} (${getRes.status})`);
  }

  const createRes = await tsFetch(`/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(schema),
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '');
    throw new Error(`Typesense create collection failed: ${schema.name} (${createRes.status}) ${text}`);
  }
}

async function ensureSyncTable(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.queryArray(`SET client_min_messages = WARNING`);
    await client.queryArray(`
      CREATE TABLE IF NOT EXISTS property.TYPESENSE_SYNC_STATE (
        id TEXT PRIMARY KEY,
        last_synced_at BIGINT NOT NULL,
        last_property_id BIGINT NOT NULL DEFAULT 0
      );
    `);
    await client.queryArray(`
      ALTER TABLE property.TYPESENSE_SYNC_STATE
      ADD COLUMN IF NOT EXISTS last_property_id BIGINT NOT NULL DEFAULT 0;
    `);
  } finally {
    client.release();
  }
}

async function getLastSyncCursor(pool: Pool): Promise<{ cursorTime: number; cursorId: number }> {
  const client = await pool.connect();
  try {
    const res = await client.queryObject<{ last_synced_at: string; last_property_id: string }>(
      `SELECT last_synced_at, COALESCE(last_property_id, 0) AS last_property_id FROM property.TYPESENSE_SYNC_STATE WHERE id = 'properties'`
    );
    if (!res.rows.length) return { cursorTime: 0, cursorId: 0 };
    return {
      cursorTime: Number(res.rows[0].last_synced_at),
      cursorId: Number(res.rows[0].last_property_id),
    };
  } finally {
    client.release();
  }
}

/** Persist cursor using an existing client (same session = reliable commit). */
async function setLastSyncCursorWithClient(
  client: { queryArray: (args: unknown) => Promise<unknown> },
  epochSeconds: number,
  propertyId: number
): Promise<void> {
  await client.queryArray(
    `INSERT INTO property.TYPESENSE_SYNC_STATE (id, last_synced_at, last_property_id) 
     VALUES ('properties', $1, $2) 
     ON CONFLICT (id) DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at, last_property_id = EXCLUDED.last_property_id`,
    [epochSeconds, Number(propertyId)]
  );
}

async function setLastSyncCursor(pool: Pool, epochSeconds: number, propertyId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await setLastSyncCursorWithClient(client, epochSeconds, propertyId);
  } finally {
    client.release();
  }
}

type PropertyDoc = {
  id: string; // Typesense doc id
  property_id: string;
  country_id: number;
  purpose_id: number | null;
  purpose_key: string | null;
  property_type_id: number | null;
  property_type_ids: number[] | null;
  property_type_key: string | null;
  property_type_keys: string[] | null;
  property_type_en: string | null;
  property_type_names_en: string[] | null;
  main_property_type_ids: number[] | null;
  main_property_type_keys: string[] | null;
  main_property_type_names_en: string[] | null;
  price: number | null;
  price_str: string | null;
  currency_id: number | null;
  currency_code: string | null;
  currency_en: string | null;
  currency_symbol: string | null;
  bedrooms: number | null;
  bedrooms_str: string | null;
  bathrooms: number | null;
  bathrooms_str: string | null;
  area_sqft: number | null;
  area_sqft_str: string | null;
  area_sqm: number | null;
  area_sqm_str: string | null;
  address: string | null;
  feature_ids: number[] | null;
  features: string[] | null;
  agent_id: number | null;
  agency_id: number | null;
  agency_name: string | null;
  profile_image_url: string | null;
  agent_name: string | null;
  agent_email: string | null;
  agent_phone: string | null;
  agent_whatsapp: string | null;
  status: string | null;
  completion_status: string | null;
  is_off_plan: boolean | null;
  is_featured: boolean;
  featured_rank: number;
  created_at: number;
  updated_at: number;
  title_en: string | null;
  title_ar: string | null;
  city_en: string | null;
  area_en: string | null;
  community_en: string | null;
  primary_image_url: string | null;
  primary_media_type: string | null;
  additional_image_urls: string[] | null;
  additional_media_types: string[] | null;
  all_image_urls: string[] | null;
  all_media_types: string[] | null;
  image_is_featured: number[] | null;
};

type MediaJsonRow = {
  url?: string | null;
  mediaType?: string | null;
  isFeatured?: boolean | null;
  displayOrder?: number | null;
};

function parseMediaJson(raw: MediaJsonRow[] | string | null | undefined): MediaJsonRow[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as MediaJsonRow[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

/**
 * Build Typesense media fields from mixed image/video rows (shared display_order).
 * Featured carousel = up to 5 featured items (or first 5 if none marked featured).
 * Primary is the first carousel item (image or video).
 */
function buildMediaDocFields(raw: MediaJsonRow[] | string | null | undefined): {
  primary_image_url: string | null;
  primary_media_type: string | null;
  additional_image_urls: string[] | null;
  additional_media_types: string[] | null;
  all_image_urls: string[] | null;
  all_media_types: string[] | null;
  image_is_featured: number[] | null;
} {
  const media = parseMediaJson(raw)
    .map((row) => ({
      url: typeof row?.url === 'string' ? row.url.trim() : '',
      mediaType: row?.mediaType === 'video' ? ('video' as const) : ('image' as const),
      isFeatured: Boolean(row?.isFeatured),
    }))
    .filter((row) => row.url.length > 0);

  if (!media.length) {
    return {
      primary_image_url: null,
      primary_media_type: null,
      additional_image_urls: null,
      additional_media_types: null,
      all_image_urls: null,
      all_media_types: null,
      image_is_featured: null,
    };
  }

  const hasFeatured = media.some((row) => row.isFeatured);
  const pool = hasFeatured ? media.filter((row) => row.isFeatured) : media;
  const carousel = pool.slice(0, 5);
  const primary = carousel[0] ?? null;
  const additional = primary ? carousel.slice(1) : carousel;

  return {
    primary_image_url: primary?.url ?? null,
    primary_media_type: primary?.mediaType ?? null,
    additional_image_urls: additional.map((row) => row.url),
    additional_media_types: additional.map((row) => row.mediaType),
    all_image_urls: media.map((row) => row.url),
    all_media_types: media.map((row) => row.mediaType),
    image_is_featured: media.map((row) => (row.isFeatured ? 1 : 0)),
  };
}

async function importDocs(docs: PropertyDoc[]): Promise<void> {
  if (!docs.length) return;
  await ensureCollection(PROPERTIES_COLLECTION_SCHEMA);

  const body = docs.map((d) => JSON.stringify(d)).join('\n');
  const res = await tsFetch(
    `/collections/properties/documents/import?action=upsert`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Typesense import network error (${res.status}) ${text}`);
  }

  // Typesense /import returns 200 even if some docs fail. 
  // Each line in the response is a JSON result for that doc.
  const resultText = await res.text();
  const lines = resultText.split('\n').filter(Boolean);
  const failures = lines
    .map((line, idx) => ({ res: JSON.parse(line), idx }))
    .filter((item) => item.res.success === false);

  if (failures.length > 0) {
    const first = failures[0];
    const firstError =
      first?.res?.error ??
      first?.res?.message ??
      (first?.res && typeof first.res === 'object' ? JSON.stringify(first.res) : null) ??
      'Unknown error';
    console.error(`Typesense import had ${failures.length} failures out of ${docs.length}`);
    console.error('First failure:', JSON.stringify(failures[0]));
    throw new Error(`Typesense import failed for ${failures.length} docs. First error: ${firstError}`);
  }
}

/** Delete documents from Typesense by id (property_id as string). */
async function deleteDocs(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await ensureCollection(PROPERTIES_COLLECTION_SCHEMA);

  // Older Typesense builds reject import?action=delete — use delete-by-filter instead.
  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const filterBy = `id:[${chunk.join(',')}]`;
    const res = await tsFetch(
      `/collections/properties/documents?filter_by=${encodeURIComponent(filterBy)}&batch_size=${chunk.length}`,
      { method: 'DELETE' }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Ignore not-found style failures for already-missing docs when possible
      if (res.status === 404) continue;
      throw new Error(`Typesense delete error (${res.status}) ${text}`);
    }
  }
}

serve(async (req) => {
  try {
    // allow scheduler GET/POST
    if (req.method !== 'GET' && req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const force = url.searchParams.get('force') === 'true';

    const dbUrl = mustGetEnv('SUPABASE_DB_URL');
    const pool = new Pool(dbUrl, 1, true);

    // Initializations
    await ensureSyncTable(pool);
    const { cursorTime: initialCursorTime, cursorId: initialCursorId } = force
      ? { cursorTime: 0, cursorId: 0 }
      : await getLastSyncCursor(pool);

    // Batch settings
    const batchSize = 200;
    let cursorTime = initialCursorTime;
    let cursorId = initialCursorId;
    let totalUpserted = 0;
    let maxSeenTime = initialCursorTime;

    // Ensure properties collection exists before first import
    await ensureCollection(PROPERTIES_COLLECTION_SCHEMA);

    // Delete from Typesense any properties whose agent or agency status is not active
    const cleanupRes = await pool.connect().then(async (client) => {
      try {
        const r = await client.queryObject<{ property_id: number }>(
          `SELECT p.property_id
           FROM property.PROPERTIES p
           JOIN business.AGENTS a ON a.agent_id = p.agent_id
           LEFT JOIN business.AGENCIES ag ON ag.agency_id = a.agency_id
           WHERE LOWER(TRIM(COALESCE(a.status, ''))) <> 'active'
              OR (ag.agency_id IS NOT NULL AND LOWER(TRIM(COALESCE(ag.status, ''))) <> 'active')`
        );
        return r.rows.map((row) => String(row.property_id));
      } finally {
        client.release();
      }
    });
    if (cleanupRes.length > 0) {
      await deleteDocs(cleanupRes);
    }

    while (true) {
      let docs: PropertyDoc[] = [];
      let toDelete: string[] = [];
      const client = await pool.connect();
      try {
        // Location: property.address only; LOCATIONS optional (country_id default 1 when null).
        // Features: PROPERTY_DETAILS.feature_ids; features (keys) derived for display.
        const result = await client.queryObject<{
          property_id: number;
          country_id: number;
          purpose_id: number | null;
          purpose_key: string | null;
          property_type_id: number | null;
          property_type_ids: number[] | null;
          property_type_key: string | null;
          property_type_keys: string[] | null;
          property_type_en: string | null;
          property_type_names_en: string[] | null;
          main_property_type_ids: number[] | null;
          main_property_type_keys: string[] | null;
          main_property_type_names_en: string[] | null;
          price: number | null;
          currency_id: number | null;
          currency_code: string | null;
          currency_en: string | null;
          currency_symbol: string | null;
          bedrooms: number | null;
          bathrooms: number | null;
          area_sqft: number | null;
          area_sqm: number | null;
          address: string | null;
          feature_ids: number[] | null;
          features: string[] | null;
          agent_id: number | null;
          agency_id: number | null;
          agency_name: string | null;
          profile_image_url: string | null;
          agent_name: string | null;
          agent_email: string | null;
          agent_phone: string | null;
          agent_whatsapp: string | null;
          agent_status: string | null;
          agency_status: string | null;
          status: string | null;
          completion_status: string | null;
          is_off_plan: boolean | null;
          is_featured: boolean;
          featured_rank: number | null;
          created_at: string;
          updated_at: string;
          title_en: string | null;
          title_ar: string | null;
          city_en: string | null;
          area_en: string | null;
          community_en: string | null;
          media_json: MediaJsonRow[] | string | null;
          updated_epoch: number | bigint;
        }>(
          `
          WITH base AS (
            SELECT
              p.property_id,
              COALESCE(l.country_id, 1) AS country_id,
              p.purpose_id,
              pur.purpose_key,
              (p.property_type_ids)[1] AS property_type_id,
              p.property_type_ids,
              p.main_property_type_ids,
              pt_primary.type_key AS property_type_key,
              pt_primary.name_translations->>'en' AS property_type_en,
              pt_all.property_type_keys,
              pt_all.property_type_names_en,
              mpt_all.main_property_type_keys,
              mpt_all.main_property_type_names_en,
              p.price,
              p.currency_id,
              cur.currency_code,
              COALESCE(cur.name_translations->>'en', cur.currency_code) AS currency_en,
              cur.currency_symbol,
              pd.bedrooms,
              pd.bathrooms,
              pd.area_sqft,
              pd.area_sqm,
              p.address,
              pd.feature_ids AS feature_ids,
              a.agent_id,
              ag.agency_id AS agency_id,
              (ag.translations->'en'->>'name') AS agency_name,
              a.profile_image_url,
              a.agent_name,
              a.email AS agent_email,
              a.phone AS agent_phone,
              a.whatsapp AS agent_whatsapp,
              a.status AS agent_status,
              ag.status AS agency_status,
              p.status,
              p.completion_status,
              p.is_off_plan,
              COALESCE(p.is_featured, FALSE) AS is_featured,
              p.featured_rank AS featured_rank,
              p.created_at,
              GREATEST(
                p.updated_at,
                COALESCE(pd.updated_at, p.updated_at),
                COALESCE(l.updated_at, p.updated_at),
                COALESCE(a.updated_at, p.updated_at),
                COALESCE(ag.updated_at, p.updated_at)
              ) AS updated_at,
              p.title_translations->>'en' AS title_en,
              p.title_translations->>'ar' AS title_ar,
              l.translations->'en'->>'city' AS city_en,
              l.translations->'en'->>'area' AS area_en,
              l.translations->'en'->>'community' AS community_en
            FROM property.PROPERTIES p
            LEFT JOIN property.LOCATIONS l ON l.location_id = p.location_id
            LEFT JOIN property.PROPERTY_DETAILS pd ON pd.property_id = p.property_id
            LEFT JOIN property.PURPOSES pur ON pur.purpose_id = p.purpose_id
            LEFT JOIN master.CURRENCIES cur ON cur.currency_id = p.currency_id
            LEFT JOIN business.AGENTS a ON a.agent_id = p.agent_id
            LEFT JOIN business.AGENCIES ag ON ag.agency_id = a.agency_id
            LEFT JOIN property.PROPERTY_TYPES pt_primary
              ON pt_primary.type_id = (p.property_type_ids)[1]
            LEFT JOIN LATERAL (
              SELECT
                ARRAY_AGG(pt.type_key ORDER BY pt.type_id) AS property_type_keys,
                ARRAY_AGG(COALESCE(pt.name_translations->>'en', pt.type_key) ORDER BY pt.type_id) AS property_type_names_en
              FROM unnest(COALESCE(p.property_type_ids, '{}')) AS tid
              JOIN property.PROPERTY_TYPES pt ON pt.type_id = tid
            ) pt_all ON TRUE
            LEFT JOIN LATERAL (
              SELECT
                ARRAY_AGG(mpt.main_type_key ORDER BY mpt.main_type_id) AS main_property_type_keys,
                ARRAY_AGG(COALESCE(mpt.name_translations->>'en', mpt.main_type_key) ORDER BY mpt.main_type_id) AS main_property_type_names_en
              FROM unnest(COALESCE(p.main_property_type_ids, '{}')) AS mid
              JOIN property.MAIN_PROPERTY_TYPES mpt ON mpt.main_type_id = mid
            ) mpt_all ON TRUE
          )
          SELECT
            b.*,
            feats.features,
            media.media_json,
            EXTRACT(
              EPOCH FROM GREATEST(
                b.updated_at,
                COALESCE(img_times.last_compressed_at, b.updated_at)
              )
            )::bigint AS updated_epoch
          FROM base b
          LEFT JOIN LATERAL (
            SELECT ARRAY(
              SELECT f.feature_key FROM unnest(COALESCE(b.feature_ids, '{}')) AS fid
              JOIN property.FEATURES f ON f.feature_id = fid
            ) AS features
          ) feats ON TRUE
          LEFT JOIN LATERAL (
            SELECT COALESCE(
              json_agg(
                json_build_object(
                  'url', m.url,
                  'mediaType', m.media_type,
                  'isFeatured', m.is_featured,
                  'displayOrder', m.display_order
                )
                ORDER BY m.display_order ASC NULLS LAST, m.tie ASC, m.id ASC
              ),
              '[]'::json
            ) AS media_json
            FROM (
              SELECT
                COALESCE(pi.compressed_image_url, pi.image_url) AS url,
                'image'::text AS media_type,
                COALESCE(pi.is_featured, FALSE) AS is_featured,
                pi.display_order,
                0 AS tie,
                pi.image_id AS id
              FROM property.PROPERTY_IMAGES pi
              WHERE pi.property_id = b.property_id
              UNION ALL
              SELECT
                pv.video_url AS url,
                'video'::text AS media_type,
                COALESCE(pv.is_featured, FALSE) AS is_featured,
                pv.display_order,
                1 AS tie,
                pv.video_id AS id
              FROM property.property_videos pv
              WHERE pv.property_id = b.property_id
                AND pv.video_url IS NOT NULL
                AND btrim(pv.video_url) <> ''
            ) m
          ) media ON TRUE
          LEFT JOIN LATERAL (
            SELECT MAX(pi.last_compressed_at) AS last_compressed_at
            FROM property.PROPERTY_IMAGES pi
            WHERE pi.property_id = b.property_id
          ) img_times ON TRUE
          WHERE (
            EXTRACT(
              EPOCH FROM GREATEST(
                b.updated_at,
                COALESCE(img_times.last_compressed_at, b.updated_at)
              )
            )::bigint > $1
          )
             OR (
               EXTRACT(
                 EPOCH FROM GREATEST(
                   b.updated_at,
                   COALESCE(img_times.last_compressed_at, b.updated_at)
                 )
               )::bigint = $1
               AND b.property_id > $3
             )
          ORDER BY updated_epoch ASC, b.property_id ASC
          LIMIT $2
          `,
          [cursorTime, batchSize, cursorId]
        );

        const rows = result.rows;
        if (!rows.length) break;

        const isActive = (s: string | null) =>
          s != null && String(s).trim().toLowerCase() === 'active';
        docs = rows
          .filter((r) => {
            if (!isActive(r.status)) {
              toDelete.push(String(r.property_id));
              return false;
            }
            if (r.agent_id != null && !isActive(r.agent_status)) {
              toDelete.push(String(r.property_id));
              return false;
            }
            if (r.agency_id != null && !isActive(r.agency_status)) {
              toDelete.push(String(r.property_id));
              return false;
            }
            return true;
          })
          .map((r) => {
            const featuredRank =
              typeof r.featured_rank === 'number' ? r.featured_rank : 2147483647;
            const createdAt = Math.floor(new Date(r.created_at).getTime() / 1000);
            const updatedAt =
              typeof r.updated_epoch === 'bigint' ? Number(r.updated_epoch) : r.updated_epoch;
            const mainPropertyTypeIds =
              r.main_property_type_ids?.length ? r.main_property_type_ids : [1];
            const mainPropertyTypeKeys =
              r.main_property_type_keys?.length ? r.main_property_type_keys : ['residential'];
            const mainPropertyTypeNamesEn =
              r.main_property_type_names_en?.length
                ? r.main_property_type_names_en
                : ['Residential'];
            return {
              id: String(r.property_id),
              property_id: String(r.property_id),
              country_id: r.country_id,
              purpose_id: r.purpose_id,
              purpose_key: r.purpose_key,
              property_type_id: r.property_type_id,
              property_type_ids: r.property_type_ids ?? null,
              property_type_key: r.property_type_key ?? null,
              property_type_keys: r.property_type_keys ?? null,
              property_type_en: r.property_type_en ?? null,
              property_type_names_en: r.property_type_names_en ?? null,
              main_property_type_ids: mainPropertyTypeIds,
              main_property_type_keys: mainPropertyTypeKeys,
              main_property_type_names_en: mainPropertyTypeNamesEn,
              price: r.price !== null ? Number(r.price) : null,
              price_str: priceStr(
                r.price !== null ? Number(r.price) : null,
                r.currency_code
              ),
              currency_id: r.currency_id,
              currency_code: r.currency_code ?? null,
              currency_en: r.currency_en ?? null,
              currency_symbol: r.currency_symbol ?? null,
              bedrooms: r.bedrooms,
              bedrooms_str: bedroomsStr(r.bedrooms),
              bathrooms: r.bathrooms,
              bathrooms_str: bathroomsStr(r.bathrooms),
              area_sqft: r.area_sqft !== null ? Number(r.area_sqft) : null,
              area_sqft_str: areaSqftStr(
                r.area_sqft !== null ? Number(r.area_sqft) : null
              ),
              area_sqm: r.area_sqm !== null ? Number(r.area_sqm) : null,
              area_sqm_str: areaSqmStr(
                r.area_sqm !== null ? Number(r.area_sqm) : null
              ),
              address: r.address,
              feature_ids: r.feature_ids ?? null,
              features: r.features ?? null,
              agent_id: r.agent_id,
              agency_id: r.agency_id ?? null,
              agency_name: r.agency_name ?? null,
              profile_image_url: r.profile_image_url ?? null,
              agent_name: r.agent_name,
              agent_email: r.agent_email,
              agent_phone: r.agent_phone,
              agent_whatsapp: r.agent_whatsapp,
              status: r.status,
              completion_status: r.completion_status ?? null,
              is_off_plan: r.is_off_plan,
              is_featured: Boolean(r.is_featured),
              featured_rank: featuredRank,
              created_at: createdAt,
              updated_at: updatedAt,
              title_en: r.title_en,
              title_ar: r.title_ar,
              city_en: r.city_en,
              area_en: r.area_en,
              community_en: r.community_en,
              ...buildMediaDocFields(r.media_json),
            };
          });

        const lastRow = rows[rows.length - 1];
        const lastEpoch =
          typeof lastRow.updated_epoch === 'bigint'
            ? Number(lastRow.updated_epoch)
            : lastRow.updated_epoch;
        cursorTime = lastEpoch;
        cursorId = Number(lastRow.property_id);
        if (cursorTime > maxSeenTime) maxSeenTime = cursorTime;
        await setLastSyncCursorWithClient(client, cursorTime, cursorId);
      } finally {
        client.release();
      }

      await importDocs(docs);
      totalUpserted += docs.length;
      if (toDelete.length > 0) await deleteDocs(toDelete);
    }

    // Save final state before closing pool (so it's persisted when run completes)
    if (maxSeenTime > initialCursorTime || cursorId !== initialCursorId) {
      await setLastSyncCursor(pool, maxSeenTime, cursorId);
    }
    await pool.end();

    return new Response(
      JSON.stringify({
        ok: true,
        lastCursorTime: initialCursorTime,
        lastCursorId: initialCursorId,
        newLastSyncedAt: maxSeenTime,
        newLastPropertyId: cursorId,
        upserted: totalUpserted,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

