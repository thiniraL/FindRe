import { query } from '../lib/db/client';

async function main() {
  const feats = await query<{ feature_id: number; feature_key: string; name: string }>(
    `SELECT feature_id, feature_key, name_translations->>'en' AS name
     FROM property.FEATURES
     WHERE is_active = TRUE
       AND (
         feature_key ILIKE '%golf%' OR feature_key ILIKE '%beach%' OR feature_key ILIKE '%water%'
         OR feature_key ILIKE '%marina%' OR feature_key ILIKE '%garden%' OR feature_key ILIKE '%pool%'
         OR COALESCE(name_translations->>'en','') ILIKE '%golf%'
         OR COALESCE(name_translations->>'en','') ILIKE '%beach%'
         OR COALESCE(name_translations->>'en','') ILIKE '%water%'
         OR COALESCE(name_translations->>'en','') ILIKE '%marina%'
         OR COALESCE(name_translations->>'en','') ILIKE '%garden%'
       )
     ORDER BY feature_key`
  );
  console.log('features', JSON.stringify(feats.rows, null, 2));

  const allKeys = await query<{ feature_key: string }>(
    `SELECT feature_key FROM property.FEATURES WHERE is_active = TRUE ORDER BY feature_key`
  );
  console.log(
    'all_feature_keys',
    allKeys.rows.map((r) => r.feature_key)
  );

  const comp = await query<{ completion_status: string | null; n: number }>(
    `SELECT completion_status, COUNT(*)::int AS n
     FROM property.PROPERTIES
     GROUP BY 1
     ORDER BY 2 DESC`
  );
  console.log('completion', comp.rows);

  const main = await query<{ main_type_id: number; main_type_key: string }>(
    `SELECT main_type_id, main_type_key FROM property.MAIN_PROPERTY_TYPES`
  );
  console.log('main', main.rows);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
