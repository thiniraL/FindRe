import { readFileSync } from 'fs';
import { resolve } from 'path';

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

async function main() {
  const host = process.env.TYPESENSE_HOST!;
  const protocol = process.env.TYPESENSE_PROTOCOL || 'https';
  const port = process.env.TYPESENSE_PORT;
  const apiKey = process.env.TYPESENSE_API_KEY!;
  const base = port ? `${protocol}://${host}:${port}` : `${protocol}://${host}`;

  const params = new URLSearchParams({
    q: '*',
    query_by: 'title_en',
    filter_by: 'purpose_key:=for_sale && country_id:=1',
    facet_by: 'main_property_type_ids,property_type_id,property_type_key',
    max_facet_values: '50',
    per_page: '0',
  });

  const res = await fetch(
    `${base}/collections/properties/documents/search?${params}`,
    { headers: { 'X-TYPESENSE-API-KEY': apiKey } }
  );
  const json = (await res.json()) as {
    found: number;
    facet_counts?: Array<{
      field_name: string;
      counts: Array<{ value: string; count: number }>;
    }>;
  };
  console.log('found', json.found);
  for (const f of json.facet_counts ?? []) {
    console.log('FACET', f.field_name, JSON.stringify(f.counts, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
