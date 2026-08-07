import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env BEFORE importing db client (imports are otherwise hoisted above this)
const envPath = resolve(process.cwd(), '.env');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) continue;
  const key = trimmed.slice(0, eq).trim();
  let val = trimmed.slice(eq + 1).trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  process.env[key] = val;
}
if (!process.env.DATABASE_URL && process.env.SUPABASE_DB_URL) {
  process.env.DATABASE_URL = process.env.SUPABASE_DB_URL;
}

async function main() {
  const { query } = await import('../lib/db/client');
  const {
    resolveMainPropertyTypeIdsFromKeywords,
    resolvePropertyTypeIdsForMainKeywords,
  } = await import('../lib/search/nlDbMaps');

  const mains = await query<{ main_type_id: number; main_type_key: string; name: string }>(
    `SELECT main_type_id, main_type_key, COALESCE(name_translations->>'en', main_type_key) AS name
     FROM property.MAIN_PROPERTY_TYPES ORDER BY main_type_id`
  );
  console.log('MAIN_TYPES', JSON.stringify(mains.rows, null, 2));

  const sample = await query<{
    type_id: number;
    type_key: string;
    main_property_type_ids: number[] | null;
  }>(
    `SELECT type_id, type_key, main_property_type_ids FROM property.PROPERTY_TYPES ORDER BY type_id LIMIT 40`
  );
  console.log('PROPERTY_TYPES sample', JSON.stringify(sample.rows, null, 2));

  for (const kw of ['residential', 'commercial']) {
    const mainIds = await resolveMainPropertyTypeIdsFromKeywords([kw]);
    const typeIds = await resolvePropertyTypeIdsForMainKeywords([kw]);
    console.log(kw, { mainIds, typeIdsCount: typeIds.length, typeIds });
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
