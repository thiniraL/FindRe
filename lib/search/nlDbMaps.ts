/**
 * Resolve NL property-type / feature / main-type keywords to live DB IDs
 * (same tables as filter chips). Cached briefly to avoid per-request fan-out.
 */

import { query } from '@/lib/db/client';

type TypeRow = { type_id: number; type_key: string; name_en: string };
type FeatureRow = { feature_id: number; feature_key: string };
type MainTypeRow = { main_type_id: number; main_type_key: string };

const CACHE_TTL_MS = 5 * 60 * 1000;

let typesCache: { at: number; rows: TypeRow[] } | null = null;
let featuresCache: { at: number; rows: FeatureRow[] } | null = null;
let mainTypesCache: { at: number; rows: MainTypeRow[] } | null = null;

async function loadPropertyTypes(): Promise<TypeRow[]> {
  const now = Date.now();
  if (typesCache && now - typesCache.at < CACHE_TTL_MS) return typesCache.rows;
  const res = await query<TypeRow>(
    `
    SELECT
      type_id,
      lower(type_key) AS type_key,
      lower(COALESCE(name_translations->>'en', type_key)) AS name_en
    FROM property.PROPERTY_TYPES
    `
  );
  typesCache = { at: now, rows: res.rows };
  return res.rows;
}

async function loadFeatures(): Promise<FeatureRow[]> {
  const now = Date.now();
  if (featuresCache && now - featuresCache.at < CACHE_TTL_MS) return featuresCache.rows;
  const res = await query<FeatureRow>(
    `
    SELECT feature_id, lower(feature_key) AS feature_key
    FROM property.FEATURES
    WHERE is_active = TRUE
    `
  );
  featuresCache = { at: now, rows: res.rows };
  return res.rows;
}

async function loadMainTypes(): Promise<MainTypeRow[]> {
  const now = Date.now();
  if (mainTypesCache && now - mainTypesCache.at < CACHE_TTL_MS) return mainTypesCache.rows;
  const res = await query<MainTypeRow>(
    `
    SELECT main_type_id, lower(main_type_key) AS main_type_key
    FROM property.MAIN_PROPERTY_TYPES
    `
  );
  mainTypesCache = { at: now, rows: res.rows };
  return res.rows;
}

/** Group keys → substrings that match live type_key / name. */
const TYPE_GROUP_MATCHERS: Record<string, string[]> = {
  villa: ['villa'],
  apartment: ['apartment', 'flat', 'ground_floor', 'groundfloor'],
  ground_floor: ['ground_floor', 'groundfloor', 'ground floor'],
  penthouse: ['penthouse'],
  townhouse: ['townhouse', 'town_house', 'town house'],
  bungalow: ['bungalow'],
  studio: ['studio'],
  house: ['house', 'chalet', 'quad'],
  duplex: ['duplex'],
  semi: ['semi', 'semidetached', 'semi_detached'],
  land: ['land', 'plot'],
  chalet: ['chalet'],
  estate: ['estate'],
};

/**
 * Resolve canonical NL type groups (villa, apartment, …) to type_ids from DB.
 * Falls back to empty array on DB errors (caller may use static map).
 */
export async function resolvePropertyTypeIdsFromKeywords(
  keywords: string[]
): Promise<number[]> {
  if (!keywords.length) return [];
  try {
    const rows = await loadPropertyTypes();
    const ids = new Set<number>();
    for (const group of keywords) {
      const matchers = TYPE_GROUP_MATCHERS[group] ?? [group];
      for (const row of rows) {
        const hay = `${row.type_key} ${row.name_en}`;
        if (matchers.some((m) => hay.includes(m.replace(/\s+/g, '_')) || hay.includes(m))) {
          ids.add(row.type_id);
        }
      }
    }
    return [...ids];
  } catch {
    return [];
  }
}

/** Resolve feature keys (golf, beachfront, …) to feature_ids from DB (exact / underscore-normalized only). */
export async function resolveFeatureIdsFromKeys(keys: string[]): Promise<number[]> {
  if (!keys.length) return [];
  try {
    const rows = await loadFeatures();
    const wanted = new Set(
      keys.flatMap((k) => {
        const lower = k.toLowerCase();
        const norm = lower.replace(/[\s-]+/g, '_');
        // beachfront also tries beach_front
        return lower === 'beachfront' ? [lower, norm, 'beach_front', 'beach'] : [lower, norm];
      })
    );
    const ids: number[] = [];
    for (const row of rows) {
      if (wanted.has(row.feature_key)) ids.push(row.feature_id);
    }
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

/** Resolve residential / commercial keywords to main_type_ids. */
export async function resolveMainPropertyTypeIdsFromKeywords(
  keywords: string[]
): Promise<number[]> {
  if (!keywords.length) return [];
  try {
    const rows = await loadMainTypes();
    const ids: number[] = [];
    for (const kw of keywords) {
      const k = kw.toLowerCase();
      for (const row of rows) {
        if (row.main_type_key === k || row.main_type_key.includes(k)) {
          ids.push(row.main_type_id);
        }
      }
    }
    return [...new Set(ids)];
  } catch {
    return [];
  }
}
