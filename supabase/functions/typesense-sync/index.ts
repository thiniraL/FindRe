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
    { name: 'price', type: 'float', facet: true, optional: true },
    { name: 'currency_id', type: 'int32', facet: true, optional: true },
    { name: 'bedrooms', type: 'int32', facet: true, optional: true },
    { name: 'bathrooms', type: 'int32', facet: true, optional: true },
    { name: 'area_sqft', type: 'float', facet: true, optional: true },
    { name: 'area_sqm', type: 'float', facet: true, optional: true },
    // Location search uses address text
    { name: 'address', type: 'string', optional: true },
    // Feature keys, e.g. ["pool","air_conditioning"]
    { name: 'features', type: 'string[]', facet: true, optional: true },
    { name: 'agent_id', type: 'int32', facet: true, optional: true },
    { name: 'status', type: 'string', facet: true, optional: true },
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
    { name: 'primary_image_url', type: 'string', optional: true },
    { name: 'geo', type: 'geopoint', optional: true },
  ],
};

const SYNC_STATE_COLLECTION_SCHEMA: TypesenseCollectionSchema = {
  name: 'sync_state',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'last_synced_at', type: 'int64', sort: true },
  ],
  default_sorting_field: 'last_synced_at',
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
  if (getRes.ok) return;
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

async function getLastSyncedAt(): Promise<number> {
  await ensureCollection(SYNC_STATE_COLLECTION_SCHEMA);
  const res = await tsFetch(`/collections/sync_state/documents/properties`, { method: 'GET' });
  if (res.status === 404) return 0;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Typesense sync_state read failed (${res.status}) ${text}`);
  }
  const doc = (await res.json()) as { last_synced_at?: number };
  return typeof doc.last_synced_at === 'number' ? doc.last_synced_at : 0;
}

async function setLastSyncedAt(epochSeconds: number): Promise<void> {
  await ensureCollection(SYNC_STATE_COLLECTION_SCHEMA);
  const res = await tsFetch(`/collections/sync_state/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'properties', last_synced_at: epochSeconds }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Typesense sync_state write failed (${res.status}) ${text}`);
  }
}

type PropertyDoc = {
  id: string; // Typesense doc id
  property_id: string;
  country_id: number;
  purpose_id: number | null;
  purpose_key: string | null;
  property_type_id: number | null;
  price: number | null;
  currency_id: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqft: number | null;
  area_sqm: number | null;
  address: string | null;
  features: string[] | null;
  agent_id: number | null;
  agent_name: string | null;
  status: string | null;
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
    throw new Error(`Typesense import failed (${res.status}) ${text}`);
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

    const dbUrl = mustGetEnv('SUPABASE_DB_URL');
    const lastSyncedAt = await getLastSyncedAt();

    // Batch settings
    const batchSize = 200;
    let cursor = lastSyncedAt;
    let totalUpserted = 0;
    let maxSeen = lastSyncedAt;

    const pool = new Pool(dbUrl, 1, true);

    // Ensure properties collection exists before first import
    await ensureCollection(PROPERTIES_COLLECTION_SCHEMA);

    while (true) {
      const client = await pool.connect();
      try {
        // NOTE: v1 uses PROPERTIES.updated_at as change source, plus FEATURED_PROPERTIES.updated_at
        // If you later need “deep” change detection for images/features, switch to an outbox table.
        const result = await client.queryObject<{
          property_id: number;
          country_id: number;
          purpose_id: number | null;
          purpose_key: string | null;
          property_type_id: number | null;
          price: number | null;
          currency_id: number | null;
          bedrooms: number | null;
          bathrooms: number | null;
          area_sqft: number | null;
          area_sqm: number | null;
          address: string | null;
          features: string[] | null;
          agent_id: number | null;
          agent_name: string | null;
          status: string | null;
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
          // Deno Postgres returns BIGINT as bigint
          updated_epoch: number | bigint;
        }>(
          `
          WITH base AS (
            SELECT
              p.property_id,
              l.country_id,
              p.purpose_id,
              pur.purpose_key,
              p.property_type_id,
              p.price,
              p.currency_id,
              pd.bedrooms,
              pd.bathrooms,
              pd.area_sqft,
              pd.area_sqm,
              p.address,
              pd.features AS features_jsonb,
              a.agent_id,
              a.agent_name,
              p.status,
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
            JOIN property.LOCATIONS l ON l.location_id = p.location_id
            LEFT JOIN property.PROPERTY_DETAILS pd ON pd.property_id = p.property_id
            LEFT JOIN property.PURPOSES pur ON pur.purpose_id = p.purpose_id
            LEFT JOIN business.AGENTS a ON a.agent_id = p.agent_id
          )
          SELECT
            b.*,
            img.image_url AS primary_image_url,
            feats.features,
            EXTRACT(EPOCH FROM b.updated_at)::bigint AS updated_epoch
          FROM base b
          LEFT JOIN LATERAL (
            SELECT pi.image_url
            FROM property.PROPERTY_IMAGES pi
            WHERE pi.property_id = b.property_id
            ORDER BY pi.is_primary DESC, pi.display_order ASC, pi.image_id ASC
            LIMIT 1
          ) img ON TRUE
          LEFT JOIN LATERAL (
            -- Convert JSONB array of strings into text[] for Typesense string[]
            SELECT ARRAY(
              SELECT jsonb_array_elements_text(COALESCE(b.features_jsonb, '[]'::jsonb))
            ) AS features
          ) feats ON TRUE
          WHERE EXTRACT(EPOCH FROM b.updated_at)::bigint > $1
          ORDER BY updated_epoch ASC, b.property_id ASC
          LIMIT $2
          `,
          [cursor, batchSize]
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
            price: r.price,
            currency_id: r.currency_id,
            bedrooms: r.bedrooms,
            bathrooms: r.bathrooms,
            area_sqft: r.area_sqft,
            area_sqm: r.area_sqm,
            address: r.address,
            features: r.features ?? null,
            agent_id: r.agent_id,
            agent_name: r.agent_name,
            status: r.status,
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
          };
        });

        await importDocs(docs);

        totalUpserted += docs.length;
        const batchMax = Math.max(...docs.map((d) => d.updated_at));
        if (batchMax > maxSeen) maxSeen = batchMax;
        cursor = batchMax;
      } finally {
        client.release();
      }
    }

    await pool.end();

    if (maxSeen > lastSyncedAt) {
      await setLastSyncedAt(maxSeen);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        lastSyncedAt,
        newLastSyncedAt: maxSeen,
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

