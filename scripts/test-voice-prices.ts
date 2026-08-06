import {
  parseNaturalLanguageQuery,
  hasStructuredNaturalLanguageHints,
  resolveNaturalLanguageSearchMode,
} from '../lib/search/naturalLanguageQuery';

const qs = [
  // Voice / typed price variants (same intent)
  'Show me houses between one hundred thousand and two hundred thousand euros.',
  'Show me houses between 100,000 and €200,000',
  'Show me houses between 100000 and 200000',
  'Show me houses between €100000 and €200000',
  'Show me houses between 100000 and 200000 euros',
  'Show me houses between 100.000 and 200.000 euros',
  'Show me houses between 100 000 and 200 000 euros',
  'under €250,000',
  'under 250000 EUR',
  'under 250,000',
  // Sheet rows that were Fail on retest
  'Show me a commercial property under 8 hundred thousand euros.',
  'Find a bungalow with 3 bedrooms and 2 bathrooms.',
  'Search for a apartment under three hundred thousand euros.',
  'Find a house in Orihuela Costa with at least 120 square meters.',
  'Show me a residential property with 2 bedrooms, 1 bathroom, and a golf view.',
  'Find an apartment in Los Altos between 75 and 100 square meters under two hundred thousand euros.',
  "I'm looking for a modern 3-bedroom apartment in Alicante under €250,000.",
  'Find me a beachfront property with at least 2 bedrooms',
  'Show me commercial properties with more than 200 square meters.',
  'I want a residential house with 4 bedrooms, 2 bathrooms, and a garden.',
  'Show me newly built properties',
  'Find properties close to a marina under €400,000.',
  'Find properties close to a marina under €400000.',
];

const BASE = process.env.NL_RETEST_BASE_URL?.replace(/\/$/, '') || '';

async function liveCount(q: string): Promise<number | null> {
  if (!BASE) return null;
  try {
    const res = await fetch(`${BASE}/api/search/count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, countryId: 1 }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { totalCount?: number }; totalCount?: number };
    return json.data?.totalCount ?? json.totalCount ?? null;
  } catch {
    return null;
  }
}

async function main() {
  for (const q of qs) {
    const nl = parseNaturalLanguageQuery(q);
    const s = hasStructuredNaturalLanguageHints(nl);
    const { willUseNl } = resolveNaturalLanguageSearchMode(q, 'm', false, {
      hasStructuredHints: s,
    });
    const n = await liveCount(q);
    console.log(
      JSON.stringify({
        mode: willUseNl ? 'NL' : 'RULE',
        n,
        priceMin: nl.priceMin,
        priceMax: nl.priceMax,
        beds: nl.bedrooms,
        baths: nl.bathrooms,
        areaMin: nl.areaMin,
        areaMax: nl.areaMax,
        types: nl.propertyTypeKeywords,
        features: nl.featureKeys,
        loc: nl.location,
        q,
      })
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
