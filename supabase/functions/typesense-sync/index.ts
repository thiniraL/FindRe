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
    { name: 'main_property_type_ids', type: 'int32[]', facet: true, optional: true },
    { name: 'price', type: 'float', facet: true, optional: true },
    { name: 'currency_id', type: 'int32', facet: true, optional: true },
    { name: 'bedrooms', type: 'int32', facet: true, optional: true },
    { name: 'bathrooms', type: 'int32', facet: true, optional: true },
    { name: 'area_sqft', type: 'float', facet: true, optional: true },
    { name: 'area_sqm', type: 'float', facet: true, optional: true },
    // Location search uses address text
    { name: 'address', type: 'string', optional: true },
    // Feature IDs (filter by feature_ids); display keys in features
    { name: 'feature_ids', type: 'int32[]', facet: true, optional: true },
    { name: 'features', type: 'string[]', facet: true, optional: true },
    { name: 'agent_id', type: 'int32', facet: true, optional: true },
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
    { name: 'additional_image_urls', type: 'string[]', optional: true },
    { name: 'geo', type: 'geopoint', optional: true },
  ],
};

function mustGetEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v || !v.trim()) throw new Error(`Missing env: ${key}`);
  return v.trim();
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

async function setLastSyncCursor(pool: Pool, epochSeconds: number, propertyId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.queryArray(
      `INSERT INTO property.TYPESENSE_SYNC_STATE (id, last_synced_at, last_property_id) 
       VALUES ('properties', $1, $2) 
       ON CONFLICT (id) DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at, last_property_id = EXCLUDED.last_property_id`,
      [epochSeconds, propertyId]
    );
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
  main_property_type_ids: number[] | null;
  price: number | null;
  currency_id: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqft: number | null;
  area_sqm: number | null;
  address: string | null;
  feature_ids: number[] | null;
  features: string[] | null;
  agent_id: number | null;
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
  additional_image_urls: string[] | null;
};

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

    while (true) {
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
          main_property_type_ids: number[] | null;
          price: number | null;
          currency_id: number | null;
          bedrooms: number | null;
          bathrooms: number | null;
          area_sqft: number | null;
          area_sqm: number | null;
          address: string | null;
          feature_ids: number[] | null;
          features: string[] | null;
          agent_id: number | null;
          agent_name: string | null;
          agent_email: string | null;
          agent_phone: string | null;
          agent_whatsapp: string | null;
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
          primary_image_url: string | null;
          additional_image_urls: string[] | null;
          // Deno Postgres returns BIGINT as bigint
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
              p.price,
              p.currency_id,
              pd.bedrooms,
              pd.bathrooms,
              pd.area_sqft,
              pd.area_sqm,
              p.address,
              pd.feature_ids AS feature_ids,
              a.agent_id,
              a.agent_name,
              a.email AS agent_email,
              a.phone AS agent_phone,
              a.whatsapp AS agent_whatsapp,
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
                COALESCE(a.updated_at, p.updated_at)
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
            LEFT JOIN business.AGENTS a ON a.agent_id = p.agent_id
          )
          SELECT
            b.*,
            img.image_url AS primary_image_url,
            feats.features,
            add_imgs.additional_image_urls,
            EXTRACT(
              EPOCH FROM GREATEST(
                b.updated_at,
                COALESCE(img_times.last_compressed_at, b.updated_at)
              )
            )::bigint AS updated_epoch
          FROM base b
          LEFT JOIN LATERAL (
            SELECT COALESCE(pi.compressed_image_url, pi.image_url) AS image_url
            FROM property.PROPERTY_IMAGES pi
            WHERE pi.property_id = b.property_id
            ORDER BY pi.is_primary DESC, pi.display_order ASC, pi.image_id ASC
            LIMIT 1
          ) img ON TRUE
          LEFT JOIN LATERAL (
            -- Derive feature keys from feature_ids for display/facet
            SELECT ARRAY(
              SELECT f.feature_key FROM unnest(COALESCE(b.feature_ids, '{}')) AS fid
              JOIN property.FEATURES f ON f.feature_id = fid
            ) AS features
          ) feats ON TRUE
          LEFT JOIN LATERAL (
            -- Fetch up to 5 additional image URLs
            SELECT ARRAY(
              SELECT COALESCE(pi.compressed_image_url, pi.image_url)
              FROM property.PROPERTY_IMAGES pi
              WHERE pi.property_id = b.property_id
                -- Exclude primary image if already picked (handle NULL primary)
                AND COALESCE(pi.compressed_image_url, pi.image_url) IS DISTINCT FROM img.image_url
              ORDER BY pi.display_order ASC, pi.image_id ASC
              LIMIT 5
            ) AS additional_image_urls
          ) add_imgs ON TRUE
          LEFT JOIN LATERAL (
            -- Track the latest compression time across all images
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

        const docs: PropertyDoc[] = rows.map((r) => {
          const featuredRank =
            typeof r.featured_rank === 'number' ? r.featured_rank : 2147483647;
          const createdAt = Math.floor(new Date(r.created_at).getTime() / 1000);
          const updatedAt =
            typeof r.updated_epoch === 'bigint' ? Number(r.updated_epoch) : r.updated_epoch;

          return {
            id: String(r.property_id),
            property_id: String(r.property_id),
            country_id: r.country_id,
            purpose_id: r.purpose_id,
            purpose_key: r.purpose_key,
            property_type_id: r.property_type_id,
            property_type_ids: r.property_type_ids ?? null,
            main_property_type_ids: r.main_property_type_ids ?? null,
            price: r.price !== null ? Number(r.price) : null,
            currency_id: r.currency_id,
            bedrooms: r.bedrooms,
            bathrooms: r.bathrooms,
            area_sqft: r.area_sqft !== null ? Number(r.area_sqft) : null,
            area_sqm: r.area_sqm !== null ? Number(r.area_sqm) : null,
            address: r.address,
            feature_ids: r.feature_ids ?? null,
            features: r.features ?? null,
            agent_id: r.agent_id,
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
            primary_image_url: r.primary_image_url,
            additional_image_urls: r.additional_image_urls,
          };
        });

        await importDocs(docs);

        totalUpserted += docs.length;

        const lastDoc = docs[docs.length - 1];
        cursorTime = lastDoc.updated_at;
        cursorId = Number(lastDoc.property_id);

        if (cursorTime > maxSeenTime) maxSeenTime = cursorTime;

        // Persist cursor after each batch so next run can resume after timeout
        await setLastSyncCursor(pool, cursorTime, cursorId);
      } finally {
        client.release();
      }
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

