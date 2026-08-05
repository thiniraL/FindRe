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
  /** Inferred from buy/rent/sale/lease words when present */
  purpose?: 'for_sale' | 'for_rent';
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

/** Longer purpose phrases first so "for rent" wins over "rent". */
const PURPOSE_PHRASES = Object.keys(PURPOSE_WORD_MAP).sort(
  (a, b) => b.length - a.length || a.localeCompare(b)
);

/** Generic intent words that rarely appear in property docs; stripping them avoids 0 results from Typesense. */
export const SEARCH_STOPWORDS = new Set<string>(['properties', 'property', 'listings', 'listing', 'list', 'agent']);

/** Filler words from conversational queries ("I want to…"). */
const INTENT_STOPWORDS = new Set<string>([
  'i',
  'im',
  "i'm",
  'want',
  'wanna',
  'to',
  'a',
  'an',
  'the',
  'and',
  'or',
  'with',
  'looking',
  'look',
  'find',
  'me',
  'my',
  'some',
  'please',
  'need',
  'needs',
  'am',
  'is',
  'are',
  'of',
  'for',
  'any',
  'show',
  'get',
]);

/** Word numbers for "one bedroom", "two baths", etc. */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const COUNT_TOKEN = `(?:\\d+|${Object.keys(NUMBER_WORDS).join('|')})`;

/** Regex for "N bed(s)/bedroom(s)" and "N bath(s)/bathroom(s)" — digits or word numbers */
const BEDS_REGEX = new RegExp(
  `\\b(${COUNT_TOKEN})\\s*(?:bed|beds|bedroom|bedrooms|br|brs)\\b`,
  'gi'
);
const BATHS_REGEX = new RegExp(
  `\\b(${COUNT_TOKEN})\\s*(?:bath|baths|bathroom|bathrooms)\\b`,
  'gi'
);
const STUDIO_REGEX = /\bstudio\b/i;

/** Words that must never become a location via the trailing-token heuristic. */
const LOCATION_REJECT_WORDS = new Set<string>([
  ...Object.keys(NUMBER_WORDS),
  ...INTENT_STOPWORDS,
  'bed',
  'beds',
  'bedroom',
  'bedrooms',
  'br',
  'brs',
  'bath',
  'baths',
  'bathroom',
  'bathrooms',
  'studio',
  'studios',
]);

/** "in <place>", "near <place>" */
const IN_PLACE_REGEX = /\b(?:in|near|at)\s+([^,]+?)(?:\s+under|\s+above|\s+with|\s*$|,)/gi;
const PRICE_UNDER_REGEX = /\b(?:under|below|max|less than)\s*[\s€$]?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|million)?/gi;
const PRICE_OVER_REGEX = /\b(?:over|above|min|more than)\s*[\s€$]?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|million)?/gi;
const PRICE_RANGE_REGEX = /\b[\s€$]?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|million)?\s*[-–—to]\s*[\s€$]?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|million)?/gi;

function parseNumber(s: string): number {
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseCountToken(s: string): number | null {
  const lower = s.toLowerCase();
  if (NUMBER_WORDS[lower] != null) return NUMBER_WORDS[lower];
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function scalePrice(num: number, suffix: string): number {
  const lower = (suffix || '').toLowerCase();
  if (lower === 'k') return num * 1_000;
  if (lower === 'm' || lower === 'million') return num * 1_000_000;
  return num;
}

function inferPurpose(lower: string): 'for_sale' | 'for_rent' | undefined {
  for (const key of PURPOSE_PHRASES) {
    const re = new RegExp(`\\b${key.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(lower)) return PURPOSE_WORD_MAP[key];
  }
  return undefined;
}

function isRejectedLocationToken(word: string): boolean {
  const w = word.toLowerCase();
  return (
    LOCATION_REJECT_WORDS.has(w) ||
    PURPOSE_WORD_MAP[w] != null ||
    SEARCH_STOPWORDS.has(w) ||
    PROPERTY_TYPE_MAP[w] != null ||
    FEATURE_MAP[w] != null ||
    /^\d+$/.test(w)
  );
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

  const purpose = inferPurpose(lower);
  if (purpose) result.purpose = purpose;

  // --- Beds ---
  BEDS_REGEX.lastIndex = 0;
  const bedMatch = BEDS_REGEX.exec(text);
  if (bedMatch) {
    const n = parseCountToken(bedMatch[1]);
    if (n != null) {
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
    const n = parseCountToken(bathMatch[1]);
    if (n != null && n >= 1) {
      result.bathrooms = [n];
    }
  }

  // --- Location: prefer "in X" / "near X"; trailing tokens only if they look like a place ---
  IN_PLACE_REGEX.lastIndex = 0;
  let placeMatch = IN_PLACE_REGEX.exec(text);
  if (placeMatch) {
    result.location = placeMatch[1].trim();
  } else {
    // e.g. "villa Costa Blanca" → Costa Blanca (reject bedroom/property/intent tails)
    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const prev = parts[parts.length - 2];
      const lastTwo = `${prev} ${last}`;
      const lastOk = !isRejectedLocationToken(last);
      const prevOk = !isRejectedLocationToken(prev);
      if (lastOk && /^[A-Za-z]/.test(last)) {
        if (prevOk && lastTwo.length <= 30) {
          result.location = lastTwo;
        } else {
          result.location = last;
        }
      }
    }
  }
  // Strip purpose words and generic stopwords from location so they aren't sent to Typesense
  if (result.location) {
    const locationWords = result.location
      .split(/\s+/)
      .filter((w) => !isRejectedLocationToken(w));
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
  for (const key of PURPOSE_PHRASES) {
    residual = residual.replace(new RegExp(`\\b${key.replace(/\s+/g, '\\s+')}\\b`, 'gi'), ' ');
  }
  for (const word of SEARCH_STOPWORDS) {
    residual = residual.replace(new RegExp(`\\b${word}\\b`, 'gi'), ' ');
  }
  for (const word of INTENT_STOPWORDS) {
    residual = residual.replace(new RegExp(`\\b${word.replace(/'/g, "\\'")}\\b`, 'gi'), ' ');
  }
  residual = residual.replace(/\s+/g, ' ').trim();
  if (residual && residual.length > 1) result.keyword = residual;
  // Avoid duplicating location in keyword (e.g. trailing-place heuristic + residual)
  if (
    result.keyword &&
    result.location &&
    result.keyword.toLowerCase() === result.location.toLowerCase()
  ) {
    result.keyword = undefined;
  }

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
 * Merge structured NL hints (beds, baths, price, property type, purpose) without location/keyword.
 * Used alongside Typesense NL so the LLM owns full-text q while known tokens become filter_by.
 */
export function mergeStructuredNaturalLanguageIntoState(
  state: Partial<SearchFilterState> & { purpose: string },
  nl: NaturalLanguageMapped
): void {
  if (nl.purpose && !state.purpose?.trim()) state.purpose = nl.purpose;
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
 * q string sent to Typesense when Natural Language Search is on.
 * Uses the original user sentence so the NL model can interpret full intent.
 */
export function getTypesenseNlQuery(rawQ: string): string {
  const trimmed = rawQ?.trim() || '';
  return trimmed.length > 0 ? trimmed : '*';
}

/**
 * Decide whether to call Typesense NL.
 * nl_query=true only when:
 *   - TYPESENSE_NL_MODEL_ID is set, AND
 *   - q is non-empty (has data), AND
 *   - caller did not opt out with nl_query=false
 * No q / empty q → normal search (no nl_query / nl_model_id).
 */
export function resolveNaturalLanguageSearchMode(
  q: string | undefined,
  nlModelId: string | undefined,
  nlQueryOptOut: boolean
): { qValue: string; willUseNl: boolean } {
  const qValue = q?.trim() || '';
  const willUseNl = !!nlModelId && !!qValue && !nlQueryOptOut;
  return { qValue, willUseNl };
}

/**
 * Apply rule-based NL parsing to q. When structuredOnly is true (Typesense NL mode),
 * only beds/baths/price/property type/purpose are merged; location and keyword stay with the LLM.
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
