/**
 * One-off NL retest: parser structure + optional live /api/search counts.
 * Run: npx tsx scripts/retest-nl-fail-list.ts
 */
import {
  hasStructuredNaturalLanguageHints,
  parseNaturalLanguageQuery,
  resolveNaturalLanguageSearchMode,
} from '../lib/search/naturalLanguageQuery';
import { buildFilterBy, buildSearchQuery, type SearchFilterState } from '../lib/search/buildFilterQuery';

const QUERIES = [
  'I want to buy 2 bedrooms and 2 bath',
  'I want to buy 4 bedroom Villa',
  'I want to buy a property below 900000 EUR',
  'I want to buy below 90000 EUR property',
  'I want to buy a 3-bedroom, 2-bathroom house.',
  'I want to buy 2 bedrooms and 2 bathrooms',
  'I want to buy a property below one hundred thousand euros.',
  'Show me properties under 800000 EUR.',
  'Find apartments below two hundred thousand euros.',
  'Show me houses between one hundred thousand and two hundred thousand euros.',
  'Find properties under 80000 euros.',
  'Find a 2-bedroom, 1-bathroom apartment.',
  'Find properties with 2 or more bathrooms.',
  'Find properties in Alicante.',
  'Show me houses in Orihuela Costa.',
  'Search for a bungalow.',
  'Show me an apartment for sale.',
  'Find properties with at least 100 square meters.',
  'Show me apartments between 75 and 120 square meters.',
  'Search for properties larger than 150 square meters.',
  'Find properties near a golf course.',
  'Show me waterfront homes.',
  'Find a residential apartment in Alicante with 2 bedrooms, 1 bathroom',
  'Show me a commercial property under 8 hundred thousand euros.',
  'Find a bungalow with 3 bedrooms and 2 bathrooms.',
  'Search for a apartment under three hundred thousand euros.',
  'Find me a beachfront property with at least 2 bedrooms',
  'Show me commercial properties with more than 200 square meters.',
  'I want a residential house with 4 bedrooms, 2 bathrooms, and a garden.',
  'I want to buy a land',
  'Find the cheapest Villa',
  'Find the cheapest apartment with 2 bedrooms',
  'Show me newly built properties',
  'Find properties close to a marina under €400000.',
];

const BASE = process.env.NL_RETEST_BASE_URL?.replace(/\/$/, '') || '';

function simulateRuleState(q: string): SearchFilterState {
  const nl = parseNaturalLanguageQuery(q);
  const state: SearchFilterState = {
    purpose: nl.purpose || 'for_sale',
    countryId: 1,
  };
  if (nl.bedrooms) state.bedrooms = nl.bedrooms;
  if (nl.bathrooms) state.bathrooms = nl.bathrooms;
  if (nl.priceMin != null) state.priceMin = nl.priceMin;
  if (nl.priceMax != null) state.priceMax = nl.priceMax;
  if (nl.areaMin != null) state.areaMin = nl.areaMin;
  if (nl.areaMax != null) state.areaMax = nl.areaMax;
  if (nl.completionStatus) state.completionStatus = nl.completionStatus;
  if (nl.location) state.location = nl.location;
  if (nl.keyword) state.keyword = nl.keyword;
  if (nl.featureKeys?.length) state.featureKeys = nl.featureKeys;
  if (nl.sortBy) state.sortBy = nl.sortBy;
  // Static type fallback (DB enrichment happens in applyNaturalLanguageQuery)
  const TYPE_IDS: Record<string, number[]> = {
    villa: [26, 36, 41, 45, 57],
    apartment: [27, 35, 46, 58],
    bungalow: [33, 38, 48, 49],
    house: [34, 39, 42, 54, 55],
    land: [43, 44],
  };
  if (nl.propertyTypeKeywords?.length) {
    state.propertyTypeIds = [
      ...new Set(nl.propertyTypeKeywords.flatMap((k) => TYPE_IDS[k] ?? [])),
    ];
  }
  return state;
}

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
  console.log('NL retest (compact prices). Dual-AND skip when structured.\n');
  let structured = 0;
  let wouldUseNl = 0;
  for (const q of QUERIES) {
    const nl = parseNaturalLanguageQuery(q);
    const hints = hasStructuredNaturalLanguageHints(nl);
    const { willUseNl } = resolveNaturalLanguageSearchMode(q, 'gemini-model', false, {
      hasStructuredHints: hints,
    });
    if (hints) structured++;
    if (willUseNl) wouldUseNl++;
    const state = simulateRuleState(q);
    const filterBy = buildFilterBy(state);
    const searchQ = buildSearchQuery(state);
    const count = await liveCount(q);
    const issues: string[] = [];
    if (!hints && !willUseNl) issues.push('no-structure-and-no-nl');
    if (q.toLowerCase().includes('cheapest') && state.sortBy !== 'price:asc') {
      issues.push('missing-cheapest-sort');
    }
    if (/\b(golf|beachfront|marina|garden|waterfront)\b/i.test(q) && !state.featureKeys?.length) {
      // mapped via FEATURE_MAP into featureKeys on nl; state may use keywords instead
    }
    const priceMatch = q.match(/\b(under|below)\s+(\d{4,})\b/i);
    if (priceMatch && state.priceMax !== Number(priceMatch[2])) {
      // may have EUR etc — check numeric forms only
      if (state.priceMax == null) issues.push(`priceMax-missing-expected-${priceMatch[2]}`);
    }
    console.log(
      [
        willUseNl ? 'NL ' : 'RULE',
        hints ? 'S' : '-',
        count != null ? `n=${count}` : 'n=?',
        issues.length ? `!!${issues.join(',')}` : 'ok',
        JSON.stringify({
          q,
          priceMax: state.priceMax,
          beds: state.bedrooms,
          baths: state.bathrooms,
          areaMin: state.areaMin,
          areaMax: state.areaMax,
          types: nl.propertyTypeKeywords,
          features: state.featureKeys,
          completion: state.completionStatus,
          sort: state.sortBy,
          loc: state.location,
          filterBy,
          searchQ,
        }),
      ].join(' | ')
    );
  }
  console.log(
    `\nSummary: ${QUERIES.length} queries, ${structured} structured→rules, ${wouldUseNl} would still use Typesense NL`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
