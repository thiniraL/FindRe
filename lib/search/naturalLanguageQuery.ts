/**
 * Natural language query mapping: parse free-text search (e.g. "3 bed villa with pool in Costa Blanca")
 * into structured filter hints aligned with SEARCH_FILTER_CONFIGS and Typesense.
 * Location is address-based (property.address); features from PROPERTY_DETAILS.features only.
 */

import type { SearchFilterState } from './buildFilterQuery';

export type NaturalLanguageMapped = {
  location?: string;
  /** Residual or explicit keyword terms for full-text */
  keyword?: string;
  bedrooms?: number[];
  bathrooms?: number[];
  priceMin?: number;
  priceMax?: number;
  featureKeys?: string[];
  /** Property type keywords (villa, apartment, etc.) – client/API can map to propertyTypeIds */
  propertyTypeKeywords?: string[];
};

/** Feature words/phrases → config value (e.g. pool, garden, ac) */
const FEATURE_MAP: Record<string, string> = {
  pool: 'pool',
  pools: 'pool',
  swimming: 'pool',
  'swimming pool': 'pool',
  'swimming pools': 'pool',
  garden: 'garden',
  gardens: 'garden',
  garage: 'garage',
  garages: 'garage',
  parking: 'garage',
  balcony: 'balcony',
  balconies: 'balcony',
  elevator: 'elevator',
  lift: 'elevator',
  lifts: 'elevator',
  'air conditioning': 'ac',
  ac: 'ac',
  'a/c': 'ac',
  fireplace: 'fireplace',
  fireplaces: 'fireplace',
  security: 'security',
  'security system': 'security',
};

/**
 * Search words/phrases → canonical group key.
 * Keys include DB type_key values and common NL synonyms.
 * Match longer phrases before single words in parseNaturalLanguageQuery.
 */
const PROPERTY_TYPE_MAP: Record<string, string> = {
  // Villa family
  villa: 'villa',
  villas: 'villa',
  'detached villa': 'villa',
  'independent villa': 'villa',
  'luxury villa': 'villa',
  // Apartment / flat family
  apartment: 'apartment',
  apartments: 'apartment',
  flat: 'apartment',
  flats: 'apartment',
  'ground floor': 'ground_floor',
  groundfloor: 'ground_floor',
  'ground floor apartment': 'apartment',
  // Penthouse family
  penthouse: 'penthouse',
  penthouses: 'penthouse',
  'semi penthouse': 'penthouse',
  'duplex penthouse': 'penthouse',
  // Townhouse family
  townhouse: 'townhouse',
  townhouses: 'townhouse',
  'town house': 'townhouse',
  'terraced house': 'house',
  // Bungalow family
  bungalow: 'bungalow',
  bungalows: 'bungalow',
  'groundfloor bungalow': 'bungalow',
  'ground floor bungalow': 'bungalow',
  'top floor bungalow': 'bungalow',
  // House / semi / duplex
  house: 'house',
  houses: 'house',
  'detached house': 'house',
  'quad house': 'house',
  duplex: 'duplex',
  adosado: 'house',
  semi: 'semi',
  semidetached: 'semi',
  'semi-detached': 'semi',
  'semi detached': 'semi',
  // Other
  studio: 'studio',
  studios: 'studio',
  land: 'land',
  plot: 'land',
  chalet: 'chalet',
  'country estate': 'estate',
  estate: 'estate',
};

/**
 * Canonical group → property.PROPERTY_TYPES.type_id values (staging/production).
 * Broad NL terms expand to related variants (e.g. "villa" → villa + detached + luxury…).
 */
const PROPERTY_TYPE_KEY_TO_IDS: Record<string, number[]> = {
  villa: [26, 36, 41, 45, 57],
  apartment: [27, 35, 46, 58],
  ground_floor: [28, 46, 58],
  penthouse: [29, 40, 50, 51],
  townhouse: [30, 37],
  bungalow: [33, 38, 48, 49],
  studio: [52],
  house: [34, 39, 42, 54, 55],
  duplex: [54, 51],
  semi: [31, 32, 47],
  land: [43, 44],
  chalet: [56],
  estate: [53],
};

/** Longer phrases first so "ground floor bungalow" wins over "bungalow". */
const PROPERTY_TYPE_PHRASES = Object.keys(PROPERTY_TYPE_MAP).sort(
  (a, b) => b.length - a.length || a.localeCompare(b)
);

/** Words that indicate listing purpose. Stripped from keyword so Typesense isn't required to match them; can infer purpose when not provided. */
const PURPOSE_WORD_MAP: Record<string, 'for_sale' | 'for_rent'> = {
  selling: 'for_sale',
  sale: 'for_sale',
  buy: 'for_sale',
  buying: 'for_sale',
  purchase: 'for_sale',
  sold: 'for_sale',
  for_sale: 'for_sale',
  'for sale': 'for_sale',
  rent: 'for_rent',
  renting: 'for_rent',
  rental: 'for_rent',
  lease: 'for_rent',
  leasing: 'for_rent',
  let: 'for_rent',
  for_rent: 'for_rent',
  'for rent': 'for_rent',
};

/** Set of purpose words/phrases (lowercase) for stripping from q; exported for use in search route. */
export const PURPOSE_WORDS_SET = new Set<string>(Object.keys(PURPOSE_WORD_MAP));

/** Generic intent words that rarely appear in property docs; stripping them avoids 0 results from Typesense. */
export const SEARCH_STOPWORDS = new Set<string>(['properties', 'property', 'listings', 'listing', 'list', 'agent']);

/** Regex for "N bed(s)/bedroom(s)" and "N bath(s)/bathroom(s)" */
const BEDS_REGEX = /\b(\d+)\s*(?:bed|beds|bedroom|bedrooms|br|brs)\b/gi;
const BATHS_REGEX = /\b(\d+)\s*(?:bath|baths|bathroom|bathrooms)\b/gi;
const STUDIO_REGEX = /\bstudio\b/i;

/** "in <place>", "near <place>", "<place>" at end */
const IN_PLACE_REGEX = /\b(?:in|near|at)\s+([^,]+?)(?:\s+under|\s+above|\s+with|\s*$|,)/gi;
const PRICE_UNDER_REGEX = /\b(?:under|below|max|less than)\s*[\s€$]?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|million)?/gi;
const PRICE_OVER_REGEX = /\b(?:over|above|min|more than)\s*[\s€$]?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|million)?/gi;
const PRICE_RANGE_REGEX = /\b[\s€$]?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|million)?\s*[-–—to]\s*[\s€$]?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|million)?/gi;

function parseNumber(s: string): number {
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function scalePrice(num: number, suffix: string): number {
  const lower = (suffix || '').toLowerCase();
  if (lower === 'k') return num * 1_000;
  if (lower === 'm' || lower === 'million') return num * 1_000_000;
  return num;
}

/**
 * Parse a natural language query into structured filter hints.
 * Does not require DB; returns keywords and numbers. propertyTypeKeywords
 * can be mapped to propertyTypeIds elsewhere if needed.
 */
export function parseNaturalLanguageQuery(query: string): NaturalLanguageMapped {
  const result: NaturalLanguageMapped = {};
  if (!query?.trim()) return result;

  const text = query.trim();
  const lower = text.toLowerCase();

  // --- Beds ---
  const bedMatch = BEDS_REGEX.exec(text);
  if (bedMatch) {
    const n = parseInt(bedMatch[1], 10);
    if (Number.isFinite(n)) {
      result.bedrooms = [n];
    }
  }
  if (STUDIO_REGEX.test(text)) {
    result.bedrooms = [0];
  }

  // --- Baths ---
  BATHS_REGEX.lastIndex = 0;
  const bathMatch = BATHS_REGEX.exec(text);
  if (bathMatch) {
    const n = parseInt(bathMatch[1], 10);
    if (Number.isFinite(n) && n >= 1) {
      result.bathrooms = [n];
    }
  }

  // --- Location: "in X", "near X" ---
  IN_PLACE_REGEX.lastIndex = 0;
  let placeMatch = IN_PLACE_REGEX.exec(text);
  if (placeMatch) {
    result.location = placeMatch[1].trim();
  } else {
    // Last token or two as place (e.g. "villa Costa Blanca" -> Costa Blanca)
    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const lastTwo = parts.slice(-2).join(' ');
      const lastLower = last.toLowerCase();
      if (
        /^[A-Za-z]/.test(last) &&
        !PROPERTY_TYPE_MAP[lastLower] &&
        !FEATURE_MAP[lastLower] &&
        !/\d/.test(lastTwo)
      ) {
        result.location = lastTwo.length <= 30 ? lastTwo : last;
      }
    }
  }
  // Strip purpose words and generic stopwords from location so they aren't sent to Typesense
  if (result.location) {
    const locationWords = result.location
      .split(/\s+/)
      .filter((w) => !PURPOSE_WORD_MAP[w.toLowerCase()] && !SEARCH_STOPWORDS.has(w.toLowerCase()));
    const cleaned = locationWords.join(' ').trim();
    result.location = cleaned.length > 0 ? cleaned : undefined;
  }

  // --- Price: under X, over X, X-Y ---
  PRICE_UNDER_REGEX.lastIndex = 0;
  placeMatch = PRICE_UNDER_REGEX.exec(text);
  if (placeMatch) {
    const num = parseNumber(placeMatch[1]);
    const suffix = placeMatch[2] || '';
    result.priceMax = scalePrice(num, suffix);
  }
  PRICE_OVER_REGEX.lastIndex = 0;
  placeMatch = PRICE_OVER_REGEX.exec(text);
  if (placeMatch) {
    const num = parseNumber(placeMatch[1]);
    const suffix = placeMatch[2] || '';
    result.priceMin = scalePrice(num, suffix);
  }
  PRICE_RANGE_REGEX.lastIndex = 0;
  placeMatch = PRICE_RANGE_REGEX.exec(text);
  if (placeMatch) {
    const a = parseNumber(placeMatch[1]);
    const b = parseNumber(placeMatch[3]);
    const sufA = placeMatch[2] || '';
    const sufB = placeMatch[4] || '';
    const minP = scalePrice(Math.min(a, b), sufA);
    const maxP = scalePrice(Math.max(a, b), sufB);
    if (result.priceMin == null) result.priceMin = minP;
    if (result.priceMax == null) result.priceMax = maxP;
  }

  // --- Features: words that match FEATURE_MAP ---
  const words = lower.split(/\s+/);
  const featureSet = new Set<string>();
  for (const w of words) {
    const v = FEATURE_MAP[w];
    if (v) featureSet.add(v);
  }
  // Phrases (e.g. "air conditioning")
  if (lower.includes('air conditioning')) featureSet.add('ac');
  if (lower.includes('security system')) featureSet.add('security');
  if (featureSet.size) result.featureKeys = Array.from(featureSet);

  // --- Property type keywords (phrases before single words) ---
  const typeSet = new Set<string>();
  let typeScan = lower;
  for (const phrase of PROPERTY_TYPE_PHRASES) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(typeScan)) {
      typeSet.add(PROPERTY_TYPE_MAP[phrase]);
      typeScan = typeScan.replace(re, ' ');
    }
  }
  if (typeSet.size) result.propertyTypeKeywords = Array.from(typeSet);

  // --- Residual keyword: strip extracted parts for a cleaner full-text q ---
  BEDS_REGEX.lastIndex = 0;
  BATHS_REGEX.lastIndex = 0;
  let residual = text;
  residual = residual.replace(BEDS_REGEX, ' ').replace(BATHS_REGEX, ' ');
  residual = residual.replace(STUDIO_REGEX, ' ');
  residual = residual.replace(PRICE_UNDER_REGEX, ' ').replace(PRICE_OVER_REGEX, ' ');
  residual = residual.replace(PRICE_RANGE_REGEX, ' ');
  residual = residual.replace(IN_PLACE_REGEX, ' ');
  for (const key of Object.keys(FEATURE_MAP)) {
    residual = residual.replace(new RegExp(`\\b${key.replace(/\s+/g, '\\s+')}\\b`, 'gi'), ' ');
  }
  for (const key of PROPERTY_TYPE_PHRASES) {
    residual = residual.replace(new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'gi'), ' ');
  }
  for (const key of Object.keys(PURPOSE_WORD_MAP)) {
    residual = residual.replace(new RegExp(`\\b${key.replace(/\s+/g, '\\s+')}\\b`, 'gi'), ' ');
  }
  for (const word of SEARCH_STOPWORDS) {
    residual = residual.replace(new RegExp(`\\b${word}\\b`, 'gi'), ' ');
  }
  residual = residual.replace(/\s+/g, ' ').trim();
  if (residual && residual.length > 1) result.keyword = residual;

  return result;
}

function mergePropertyTypeKeywordsIntoState(
  state: Partial<SearchFilterState>,
  keywords: string[] | undefined
): void {
  if (!keywords?.length || state.propertyTypeIds != null) return;
  const ids = keywords.flatMap((k) => PROPERTY_TYPE_KEY_TO_IDS[k] ?? []);
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  if (unique.length) state.propertyTypeIds = unique;
}

/**
 * Merge structured NL hints (beds, baths, price, property type) without location/keyword.
 * Used alongside Typesense NL so the LLM owns full-text q while known tokens become filter_by.
 */
export function mergeStructuredNaturalLanguageIntoState(
  state: Partial<SearchFilterState> & { purpose: string },
  nl: NaturalLanguageMapped
): void {
  if (nl.bedrooms?.length && state.bedrooms == null) state.bedrooms = nl.bedrooms;
  if (nl.bathrooms?.length && state.bathrooms == null) state.bathrooms = nl.bathrooms;
  if (nl.priceMin != null && state.priceMin == null) state.priceMin = nl.priceMin;
  if (nl.priceMax != null && state.priceMax == null) state.priceMax = nl.priceMax;
  mergePropertyTypeKeywordsIntoState(state, nl.propertyTypeKeywords);
}

/**
 * Merge NL-mapped values into a filter state. Explicit values (from API params) override NL.
 */
export function mergeNaturalLanguageIntoState(
  state: Partial<SearchFilterState> & { purpose: string },
  nl: NaturalLanguageMapped
): void {
  if (nl.location != null && state.location == null) state.location = nl.location;
  if (nl.keyword != null) {
    state.keyword = state.keyword ? `${state.keyword} ${nl.keyword}` : nl.keyword;
  }
  mergeStructuredNaturalLanguageIntoState(state, nl);
}

/**
 * Build q for Typesense NL after structured tokens are merged into filter_by.
 * Keeps location/residual keywords; uses '*' when everything was parsed structurally.
 */
export function getTypesenseNlQuery(rawQ: string): string {
  const parsed = parseNaturalLanguageQuery(rawQ);
  const parts: string[] = [];
  if (parsed.location?.trim()) parts.push(parsed.location.trim());
  if (parsed.keyword?.trim()) parts.push(parsed.keyword.trim());
  const combined = parts.join(' ').trim();
  return combined.length > 0 ? combined : '*';
}

/**
 * Decide whether to call Typesense NL. When every token in q maps to structured filters,
 * sanitized q is '*' and we skip NL (filter_by + q='*' is more reliable).
 */
export function resolveNaturalLanguageSearchMode(
  q: string | undefined,
  nlModelId: string | undefined,
  nlQueryOptOut: boolean
): { qValue: string; willUseNl: boolean } {
  const qValue = q?.trim() || '';
  const nlAvailable = !!nlModelId && !!qValue && !nlQueryOptOut;
  const sanitizedNlQ = nlAvailable ? getTypesenseNlQuery(qValue) : '';
  const willUseNl = nlAvailable && sanitizedNlQ !== '*';
  return { qValue, willUseNl };
}

/**
 * Apply rule-based NL parsing to q. When structuredOnly is true (Typesense NL mode),
 * only beds/baths/price/property type are merged; location and keyword stay with the LLM.
 */
export function applyNaturalLanguageQuery(
  state: Partial<SearchFilterState> & { purpose: string },
  q: string,
  options: { structuredOnly: boolean }
): void {
  const nl = parseNaturalLanguageQuery(q);
  if (options.structuredOnly) {
    mergeStructuredNaturalLanguageIntoState(state, nl);
  } else {
    mergeNaturalLanguageIntoState(state, nl);
  }
}
