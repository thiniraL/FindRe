import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq <= 0) continue;
  let k = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  process.env[k] = v;
}

const host = process.env.TYPESENSE_HOST!;
const protocol = process.env.TYPESENSE_PROTOCOL || 'https';
const port = process.env.TYPESENSE_PORT;
const apiKey = process.env.TYPESENSE_API_KEY!;
const base = port ? `${protocol}://${host}:${port}` : `${protocol}://${host}`;

async function search(filterBy: string) {
  const params = new URLSearchParams({
    q: '*',
    query_by: 'title_en',
    filter_by: filterBy,
    per_page: '0',
  });
  const res = await fetch(`${base}/collections/properties/documents/search?${params}`, {
    headers: { 'X-TYPESENSE-API-KEY': apiKey },
  });
  const j = (await res.json()) as { found: number };
  console.log(filterBy, '->', j.found);
}

async function main() {
  await search('purpose_key:=for_sale && country_id:=1');
  await search('purpose_key:=for_sale && country_id:=1 && property_type_key:=apartment');
  await search(
    'purpose_key:=for_sale && country_id:=1 && (property_type_id:=[27,35,46,58] || property_type_ids:=[27,35,46,58])'
  );

  const params = new URLSearchParams({
    q: '*',
    query_by: 'title_en',
    filter_by: 'purpose_key:=for_sale && country_id:=1',
    per_page: '3',
  });
  const res = await fetch(`${base}/collections/properties/documents/search?${params}`, {
    headers: { 'X-TYPESENSE-API-KEY': apiKey },
  });
  const j = (await res.json()) as {
    hits: Array<{ document: Record<string, unknown> }>;
  };
  for (const h of j.hits ?? []) {
    const d = h.document;
    console.log({
      id: d.property_id,
      main: d.main_property_type_ids,
      ptid: d.property_type_id,
      ptids: d.property_type_ids,
      ptk: d.property_type_key,
      ptks: d.property_type_keys,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
