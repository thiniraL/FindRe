/**
 * Natural language query mapping: parse free-text search (e.g. "3 bed villa with pool in Costa Blanca")
 * into structured filter hints aligned with SEARCH_FILTER_CONFIGS and Typesense.
 * Location is address-based (property.address); features from PROPERTY_DETAILS.features only.
 */

import type { SearchFilterState } from './buildFilterQuery';
import {
  resolveFeatureIdsFromKeys,
  resolveMainPropertyTypeIdsFromKeywords,
  resolvePropertyTypeIdsFromKeywords,
} from './nlDbMaps';

export type NaturalLanguageMapped = {
  location?: string;
  /** Residual or explicit keyword terms for full-text */
  keyword?: string;
  /** Inferred from buy/rent/sale/lease words when present */
  purpose?: 'for_sale' | 'for_rent';
  bedrooms?: (number | string)[];
  bathrooms?: (number | string)[];
  priceMin?: number;
  priceMax?: number;
  areaMin?: number;
  areaMax?: number;
  featureKeys?: string[];
  /** Property type keywords (villa, apartment, etc.) – client/API can map to propertyTypeIds */
  propertyTypeKeywords?: string[];
  /** Main type hints: residential | commercial */
  mainPropertyTypeKeywords?: string[];
  /** Completion: ready | off_plan */
  completionStatus?: string;
  /** Typesense sort_by override (e.g. price:asc for "cheapest") */
  sortBy?: string;
};

/** Feature / amenity phrases customers say → canonical key */
const FEATURE_MAP: Record<string, string> = {
  pool: 'pool',
  pools: 'pool',
  swimming: 'pool',
  'swimming pool': 'pool',
  'swimming pools': 'pool',
  'private pool': 'pool',
  'communal pool': 'pool',
  'shared pool': 'pool',
  garden: 'garden',
  gardens: 'garden',
  'private garden': 'garden',
  garage: 'garage',
  garages: 'garage',
  parking: 'parking',
  'parking space': 'parking',
  'parking spaces': 'parking',
  balcony: 'balcony',
  balconies: 'balcony',
  terrace: 'terrace',
  terraces: 'terrace',
  elevator: 'elevator',
  lift: 'elevator',
  lifts: 'elevator',
  'air conditioning': 'ac',
  'air con': 'ac',
  ac: 'ac',
  'a/c': 'ac',
  fireplace: 'fireplace',
  fireplaces: 'fireplace',
  security: 'security',
  'security system': 'security',
  golf: 'golf',
  'golf course': 'golf',
  'golf view': 'golf',
  'near golf': 'golf',
  beachfront: 'beachfront',
  'beach front': 'beachfront',
  'beach-front': 'beachfront',
  beach: 'beachfront',
  'near the beach': 'beachfront',
  'by the beach': 'beachfront',
  waterfront: 'waterfront',
  'water front': 'waterfront',
  'sea view': 'sea_view',
  seaview: 'sea_view',
  'sea views': 'sea_view',
  marina: 'marina',
  'near marina': 'marina',
  'close to marina': 'marina',
};

/**
 * Canonical amenity → Typesense/filter keyword chip (same values as KEYWORDS filter).
 * Prefer keys that return hits in catalog full-text (beach not beachfront, lift not elevator).
 */
const FEATURE_TO_KEYWORD: Record<string, string> = {
  pool: 'pool',
  garden: 'garden',
  garage: 'garage',
  parking: 'parking',
  balcony: 'balcony',
  terrace: 'terrace',
  elevator: 'lift',
  ac: 'ac',
  fireplace: 'fireplace',
  security: 'security',
  golf: 'golf',
  beachfront: 'beach',
  waterfront: 'waterfront',
  sea_view: 'sea view',
  marina: 'marina',
};

function amenityKeysToKeywords(keys: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const kw = FEATURE_TO_KEYWORD[k] ?? k;
    const id = kw.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(kw);
  }
  return out;
}

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
  // "house" in customer speech often means any dwelling — include villa/bungalow/townhouse
  house: [34, 39, 42, 54, 55, 26, 36, 41, 45, 57, 33, 38, 48, 49, 30, 37],
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
  'search',
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

/** Phrase amounts used in prices: "one hundred thousand", "two hundred thousand" */
const WORD_AMOUNT_MAP: Record<string, number> = {
  'one hundred thousand': 100_000,
  'two hundred thousand': 200_000,
  'three hundred thousand': 300_000,
  'four hundred thousand': 400_000,
  'five hundred thousand': 500_000,
  'six hundred thousand': 600_000,
  'seven hundred thousand': 700_000,
  'eight hundred thousand': 800_000,
  'nine hundred thousand': 900_000,
  'a hundred thousand': 100_000,
  'one hundred': 100,
  'two hundred': 200,
  'three hundred': 300,
  'four hundred': 400,
  'five hundred': 500,
  'eight hundred': 800,
  thousand: 1_000,
  hundred: 100,
};

const COUNT_TOKEN = `(?:\\d+|${Object.keys(NUMBER_WORDS).join('|')})`;

/** Regex for "N bed(s)/bedroom(s)" and "N bath(s)/bathroom(s)" — digits/words, optional hyphen */
const BEDS_REGEX = new RegExp(
  `\\b(${COUNT_TOKEN})\\s*[-]?\\s*(?:bed|beds|bedroom|bedrooms|br|brs)\\b`,
  'gi'
);
const BATHS_REGEX = new RegExp(
  `\\b(${COUNT_TOKEN})\\s*[-]?\\s*(?:bath|baths|bathroom|bathrooms)\\b`,
  'gi'
);
/** "at least N bathrooms", "N or more bedrooms" → N+ */
const BEDS_PLUS_REGEX = new RegExp(
  `\\b(?:at\\s+least|minimum|min)\\s+(${COUNT_TOKEN})\\s*[-]?\\s*(?:bed|beds|bedroom|bedrooms)\\b|\\b(${COUNT_TOKEN})\\s+or\\s+more\\s+(?:bed|beds|bedroom|bedrooms)\\b`,
  'gi'
);
const BATHS_PLUS_REGEX = new RegExp(
  `\\b(?:at\\s+least|minimum|min)\\s+(${COUNT_TOKEN})\\s*[-]?\\s*(?:bath|baths|bathroom|bathrooms)\\b|\\b(${COUNT_TOKEN})\\s+or\\s+more\\s+(?:bath|baths|bathroom|bathrooms)\\b`,
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
  'eur',
  'euro',
  'euros',
  'usd',
  'sqm',
  'sq',
  'square',
  'meters',
  'metres',
  'meter',
  'metre',
  'm2',
  'thousand',
  'hundred',
  'million',
  'cheapest',
  'modern',
  'new',
  'newly',
  'built',
  'residential',
  'commercial',
  'homes',
  'home',
  'view',
  'course',
  'least',
  'more',
  'larger',
  'than',
  'between',
  'under',
  'below',
  'above',
  'over',
  'close',
  'near',
]);

const CURRENCY_SUFFIX = `(?:\\s*(?:euros|euro|eur|usd|dollars|£|€|\\$))?`;
/** Digits with optional space/comma thousands: 90 000, 90,000, 90000 — (?!\d) avoids matching 20 inside 200 */
const MONEY_NUM = `(\\d+(?:[\\s,]\\d{3})*(?:\\.\\d+)?)(?!\\d)`;
const MONEY_SCALE = `(k|m|million|thousand)?`;

/** "in <place>", "near <place>", "close to <place>" — stop before price/area/with clauses */
const IN_PLACE_REGEX =
  /\b(?:in|near|at|close\s+to)\s+([A-Za-z][A-Za-z\s.'-]{1,40}?)(?=\s+(?:under|below|above|over|with|between|and|,|$)|$)/gi;

const PRICE_UNDER_REGEX = new RegExp(
  `\\b(?:under|below|max|less\\s+than)\\s*[€$£]?\\s*${MONEY_NUM}\\s*${MONEY_SCALE}${CURRENCY_SUFFIX}(?!\\s*(?:sqm|sq\\.?\\s*m|m2|square))`,
  'gi'
);
const PRICE_OVER_REGEX = new RegExp(
  `\\b(?:over|above|min|more\\s+than)\\s*[€$£]?\\s*${MONEY_NUM}\\s*${MONEY_SCALE}${CURRENCY_SUFFIX}(?!\\s*(?:sqm|sq\\.?\\s*m|m2|square))`,
  'gi'
);
/**
 * Numeric between-range for prices (voice + typed).
 * Currency may appear on either amount or as a trailing word (€ / euros / EUR).
 * Without currency, only large amounts are accepted (avoids "between 75 and 120" area).
 */
const PRICE_RANGE_REGEX = new RegExp(
  `\\bbetween\\s+[€$£]?\\s*${MONEY_NUM}\\s*${MONEY_SCALE}\\s+(?:and|to)\\s+[€$£]?\\s*${MONEY_NUM}\\s*${MONEY_SCALE}${CURRENCY_SUFFIX}`,
  'gi'
);

/** True if a matched span looks like money (symbol/word) rather than bare small integers. */
function priceMatchHasCurrency(span: string): boolean {
  return /[€$£]|\b(?:euros?|eur|usd|dollars)\b/i.test(span);
}

/** Accept bare numeric between-range only when clearly in price territory. */
function isLikelyPriceRange(a: number, b: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo >= 1_000 && hi >= 10_000;
}

/**
 * Normalize voice/typed money so parsers see compact integers:
 * - "100,000" / "1,250,000" (US/UK)
 * - "100.000" / "1.250.000" (EU thousands)
 * - "€ 200,000" → "€200000"
 */
function normalizeMoneyForNl(raw: string): string {
  let s = raw;
  // EU thousands groups (100.000) — not decimals like 100.5 / 75.25
  s = s.replace(/\b(\d{1,3}(?:\.\d{3})+)\b/g, (m) => m.replace(/\./g, ''));
  // US/UK thousands (100,000)
  s = s.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (m) => m.replace(/,/g, ''));
  // Tight currency symbol before amount
  s = s.replace(/([€$£])\s+(?=\d)/g, '$1');
  return s;
}

/** Area: "100 square meters", "75 and 120 sqm", "at least 100 sqm", "larger than 150 m2" */
const AREA_MIN_REGEX =
  /\b(?:at\s+least|minimum|min|larger\s+than|more\s+than|over|above)\s+(\d+(?:[.,]\d+)?)\s*(?:sqm|sq\.?\s*m|m2|square\s*met(?:er|re)s?)\b/gi;
const AREA_MAX_REGEX =
  /\b(?:under|below|max|less\s+than|up\s+to)\s+(\d+(?:[.,]\d+)?)\s*(?:sqm|sq\.?\s*m|m2|square\s*met(?:er|re)s?)\b/gi;
const AREA_RANGE_REGEX =
  /\b(?:between)\s+(\d+(?:[.,]\d+)?)\s*(?:and|to|-)\s*(\d+(?:[.,]\d+)?)\s*(?:sqm|sq\.?\s*m|m2|square\s*met(?:er|re)s?)\b/gi;
const AREA_BARE_RANGE_REGEX =
  /\b(\d+(?:[.,]\d+)?)\s*(?:and|to|-)\s*(\d+(?:[.,]\d+)?)\s*(?:sqm|sq\.?\s*m|m2|square\s*met(?:er|re)s?)\b/gi;

function parseNumber(s: string): number {
  const n = parseFloat(String(s).replace(/[\s,]/g, ''));
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
  if (lower === 'k' || lower === 'thousand') return num * 1_000;
  if (lower === 'm' || lower === 'million') return num * 1_000_000;
  return num;
}

/** Parse "under/below …" word amounts like "two hundred thousand euros". */
function parseWordPriceMax(lower: string): number | undefined {
  // "under 8 hundred thousand"
  const nHundred = lower.match(
    /\b(?:under|below|max|less\s+than)\s+(\d+)\s+hundred(?:\s+thousand)?\b/
  );
  if (nHundred) {
    const n = parseInt(nHundred[1], 10);
    return nHundred[0].includes('thousand') ? n * 100_000 : n * 100;
  }
  const under = lower.match(
    /\b(?:under|below|max|less\s+than)\s+(?:€|\$)?\s*((?:a|one|two|three|four|five|six|seven|eight|nine)(?:\s+hundred)?(?:\s+thousand)?)/i
  );
  if (!under) return undefined;
  const phrase = under[1].replace(/\s+/g, ' ').trim().toLowerCase();
  if (WORD_AMOUNT_MAP[phrase] != null) return WORD_AMOUNT_MAP[phrase];
  return undefined;
}

function parseWordPriceRange(lower: string): { min?: number; max?: number } {
  const m = lower.match(
    /\bbetween\s+((?:a|one|two|three|four|five|six|seven|eight|nine)(?:\s+hundred)?(?:\s+thousand)?)\s+and\s+((?:a|one|two|three|four|five|six|seven|eight|nine)(?:\s+hundred)?(?:\s+thousand)?)/i
  );
  if (!m) return {};
  const a = WORD_AMOUNT_MAP[m[1].replace(/\s+/g, ' ').trim().toLowerCase()];
  const b = WORD_AMOUNT_MAP[m[2].replace(/\s+/g, ' ').trim().toLowerCase()];
  if (a == null || b == null) return {};
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function inferPurpose(lower: string): 'for_sale' | 'for_rent' | undefined {
  for (const key of PURPOSE_PHRASES) {
    const re = new RegExp(`\\b${key.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(lower)) return PURPOSE_WORD_MAP[key];
  }
  return undefined;
}

function isRejectedLocationToken(word: string): boolean {
  const w = word.toLowerCase().replace(/[.,;:!?]+$/g, '');
  return (
    LOCATION_REJECT_WORDS.has(w) ||
    PURPOSE_WORD_MAP[w] != null ||
    SEARCH_STOPWORDS.has(w) ||
    PROPERTY_TYPE_MAP[w] != null ||
    FEATURE_MAP[w] != null ||
    /^\d+$/.test(w) ||
    /^\d+-/.test(w)
  );
}

function cleanLocation(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const cleaned = raw
    .replace(/[.,;:!?]+$/g, '')
    .split(/\s+/)
    .filter((w) => !isRejectedLocationToken(w))
    .join(' ')
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Parse a natural language query into structured filter hints.
 * Does not require DB; returns keywords and numbers. propertyTypeKeywords
 * can be mapped to propertyTypeIds elsewhere if needed.
 */
export function parseNaturalLanguageQuery(query: string): NaturalLanguageMapped {
  const result: NaturalLanguageMapped = {};
  if (!query?.trim()) return result;

  const text = normalizeMoneyForNl(query.trim())
    // "buy3 bathrooms" / "3bedroom" → insert spaces for tokenization
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2');
  const lower = text.toLowerCase();

  const purpose = inferPurpose(lower);
  if (purpose) result.purpose = purpose;

  // --- Beds / baths: "at least N" / "N or more" first (plus), then exact ---
  // Conversational "4 bedrooms" / "2 bathrooms" → N+ (customer usually means at least N)
  BEDS_PLUS_REGEX.lastIndex = 0;
  const bedsPlus = BEDS_PLUS_REGEX.exec(text);
  if (bedsPlus) {
    const n = parseCountToken(bedsPlus[1] || bedsPlus[2]);
    if (n != null) result.bedrooms = [`${n}+`];
  } else {
    BEDS_REGEX.lastIndex = 0;
    const bedMatch = BEDS_REGEX.exec(text);
    if (bedMatch) {
      const n = parseCountToken(bedMatch[1]);
      if (n != null) result.bedrooms = [`${n}+`];
    }
  }
  if (STUDIO_REGEX.test(text) && result.bedrooms == null) {
    result.bedrooms = [0];
  }

  BATHS_PLUS_REGEX.lastIndex = 0;
  const bathsPlus = BATHS_PLUS_REGEX.exec(text);
  if (bathsPlus) {
    const n = parseCountToken(bathsPlus[1] || bathsPlus[2]);
    if (n != null && n >= 1) result.bathrooms = [`${n}+`];
  } else {
    BATHS_REGEX.lastIndex = 0;
    const bathMatch = BATHS_REGEX.exec(text);
    if (bathMatch) {
      const n = parseCountToken(bathMatch[1]);
      if (n != null && n >= 1) result.bathrooms = [`${n}+`];
    }
  }

  // --- Location: "in/near/at/close to X" only (no trailing-token guess — too noisy) ---
  IN_PLACE_REGEX.lastIndex = 0;
  const placeMatch = IN_PLACE_REGEX.exec(text);
  if (placeMatch) {
    result.location = cleanLocation(placeMatch[1]);
  }

  // --- Area (before price so "more than 200 square meters" isn't treated as price) ---
  AREA_RANGE_REGEX.lastIndex = 0;
  let areaMatch = AREA_RANGE_REGEX.exec(text);
  if (!areaMatch) {
    AREA_BARE_RANGE_REGEX.lastIndex = 0;
    areaMatch = AREA_BARE_RANGE_REGEX.exec(text);
  }
  if (areaMatch) {
    const a = parseNumber(areaMatch[1]);
    const b = parseNumber(areaMatch[2]);
    result.areaMin = Math.min(a, b);
    result.areaMax = Math.max(a, b);
  } else {
    AREA_MIN_REGEX.lastIndex = 0;
    const amin = AREA_MIN_REGEX.exec(text);
    if (amin) result.areaMin = parseNumber(amin[1]);
    AREA_MAX_REGEX.lastIndex = 0;
    const amax = AREA_MAX_REGEX.exec(text);
    if (amax) result.areaMax = parseNumber(amax[1]);
  }

  // --- Price: word amounts first (so "under 8 hundred thousand" isn't priceMax=8), then numeric ---
  const wordMax = parseWordPriceMax(lower);
  const wordRange = parseWordPriceRange(lower);
  if (wordMax != null) result.priceMax = wordMax;
  if (wordRange.min != null) result.priceMin = wordRange.min;
  if (wordRange.max != null) result.priceMax = wordRange.max;

  if (result.priceMax == null) {
    PRICE_UNDER_REGEX.lastIndex = 0;
    const priceMatch = PRICE_UNDER_REGEX.exec(text);
    if (priceMatch) {
      result.priceMax = scalePrice(parseNumber(priceMatch[1]), priceMatch[2] || '');
    }
  }
  if (result.priceMin == null) {
    PRICE_OVER_REGEX.lastIndex = 0;
    const priceMatch = PRICE_OVER_REGEX.exec(text);
    if (priceMatch) {
      result.priceMin = scalePrice(parseNumber(priceMatch[1]), priceMatch[2] || '');
    }
  }
  if (result.priceMin == null && result.priceMax == null) {
    PRICE_RANGE_REGEX.lastIndex = 0;
    const priceMatch = PRICE_RANGE_REGEX.exec(text);
    if (priceMatch) {
      const a = scalePrice(parseNumber(priceMatch[1]), priceMatch[2] || '');
      const b = scalePrice(parseNumber(priceMatch[3]), priceMatch[4] || '');
      if (priceMatchHasCurrency(priceMatch[0]) || isLikelyPriceRange(a, b)) {
        result.priceMin = Math.min(a, b);
        result.priceMax = Math.max(a, b);
      }
    }
  }
  // "below one 90 000" — optional filler word between below and amount
  if (result.priceMax == null) {
    const spaced = text.match(
      /\b(?:under|below)\s+(?:one|a)?\s*[€$]?\s*(\d+(?:[\s,]\d{3})+)\s*(k|m|million|thousand)?/i
    );
    if (spaced) {
      result.priceMax = scalePrice(parseNumber(spaced[1]), spaced[2] || '');
    }
  }

  // --- Completion / new build ---
  // Only explicit off-plan / under construction → completion filter.
  // "newly built" / "new build" is not mapped to completion_status (catalog values vary / often empty).
  if (/\b(?:off[-\s]?plan|under\s+construction)\b/i.test(text)) {
    result.completionStatus = 'off_plan';
  } else if (/\b(?:ready|completed|resale)\b/i.test(text)) {
    result.completionStatus = 'ready';
  }

  // --- Sort: cheapest / lowest price ---
  if (/\b(?:cheapest|lowest\s+price|least\s+expensive|lowest\s+priced)\b/i.test(text)) {
    result.sortBy = 'price:asc';
  }

  // --- Main type: residential / commercial ---
  if (/\bresidential\b/i.test(text)) result.mainPropertyTypeKeywords = ['residential'];
  if (/\bcommercial\b/i.test(text)) result.mainPropertyTypeKeywords = ['commercial'];

  // --- Features ---
  const featureSet = new Set<string>();
  for (const phrase of Object.keys(FEATURE_MAP).sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(lower)) featureSet.add(FEATURE_MAP[phrase]);
  }
  if (featureSet.size) result.featureKeys = Array.from(featureSet);

  // --- Property type keywords ---
  const typeSet = new Set<string>();
  let typeScan = lower;
  for (const phrase of PROPERTY_TYPE_PHRASES) {
    const re = new RegExp(
      `\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`,
      'i'
    );
    if (re.test(typeScan)) {
      typeSet.add(PROPERTY_TYPE_MAP[phrase]);
      typeScan = typeScan.replace(re, ' ');
    }
  }
  // "homes" / "home" → house only when no stronger type and no amenity
  // (amenity + generic "homes" would AND type IDs and wipe garden/terrace stock)
  if (/\bhomes?\b/i.test(text) && !typeSet.size && !featureSet.size) typeSet.add('house');
  if (typeSet.size) result.propertyTypeKeywords = Array.from(typeSet);

  // --- Residual keyword ---
  BEDS_REGEX.lastIndex = 0;
  BATHS_REGEX.lastIndex = 0;
  let residual = text;
  residual = residual.replace(BEDS_PLUS_REGEX, ' ').replace(BATHS_PLUS_REGEX, ' ');
  residual = residual.replace(BEDS_REGEX, ' ').replace(BATHS_REGEX, ' ');
  residual = residual.replace(STUDIO_REGEX, ' ');
  // Area before price so "between 75 and 120 square meters" is not stripped to leftover "square meters"
  residual = residual.replace(AREA_MIN_REGEX, ' ').replace(AREA_MAX_REGEX, ' ');
  residual = residual.replace(AREA_RANGE_REGEX, ' ').replace(AREA_BARE_RANGE_REGEX, ' ');
  residual = residual.replace(PRICE_UNDER_REGEX, ' ').replace(PRICE_OVER_REGEX, ' ');
  residual = residual.replace(PRICE_RANGE_REGEX, ' ');
  residual = residual.replace(IN_PLACE_REGEX, ' ');
  residual = residual.replace(
    /\b(?:sqm|sq\.?\s*m|m2|square\s*met(?:er|re)s?)\b/gi,
    ' '
  );
  for (const key of Object.keys(WORD_AMOUNT_MAP).sort((a, b) => b.length - a.length)) {
    residual = residual.replace(new RegExp(`\\b${key.replace(/\s+/g, '\\s+')}\\b`, 'gi'), ' ');
  }
  residual = residual.replace(/\b(?:under|below|between|above|over|at\s+least|more\s+than|less\s+than|close\s+to)\b/gi, ' ');
  residual = residual.replace(/\b(?:euros|euro|eur|usd)\b/gi, ' ');
  residual = residual.replace(/[€$£]/g, ' ');
  residual = residual.replace(/\b(?:newly\s+built|new\s+build|off[-\s]?plan|under\s+construction|ready|completed|resale|residential|commercial|modern|cheapest|lowest\s+price|least\s+expensive)\b/gi, ' ');
  for (const key of Object.keys(FEATURE_MAP).sort((a, b) => b.length - a.length)) {
    residual = residual.replace(
      new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'gi'),
      ' '
    );
  }
  for (const key of PROPERTY_TYPE_PHRASES) {
    residual = residual.replace(
      new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'gi'),
      ' '
    );
  }
  residual = residual.replace(/\bhomes?\b/gi, ' ');
  for (const key of PURPOSE_PHRASES) {
    residual = residual.replace(new RegExp(`\\b${key.replace(/\s+/g, '\\s+')}\\b`, 'gi'), ' ');
  }
  for (const word of SEARCH_STOPWORDS) {
    residual = residual.replace(new RegExp(`\\b${word}\\b`, 'gi'), ' ');
  }
  for (const word of INTENT_STOPWORDS) {
    residual = residual.replace(
      new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\']/g, '\\$&')}\\b`, 'gi'),
      ' '
    );
  }
  residual = residual.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (residual && residual.length > 1) result.keyword = residual;
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
  keywords: string[] | undefined,
  resolvedIds?: number[]
): void {
  if (state.propertyTypeIds != null) return;
  if (resolvedIds?.length) {
    state.propertyTypeIds = resolvedIds;
    return;
  }
  if (!keywords?.length) return;
  const ids = keywords.flatMap((k) => PROPERTY_TYPE_KEY_TO_IDS[k] ?? []);
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  if (unique.length) state.propertyTypeIds = unique;
}

/**
 * True when rule parser extracted enough structured filters that Typesense NL
 * should be skipped (avoids rule filter_by AND LLM filters → 0 hits).
 */
export function hasStructuredNaturalLanguageHints(nl: NaturalLanguageMapped): boolean {
  return !!(
    nl.bedrooms?.length ||
    nl.bathrooms?.length ||
    nl.priceMin != null ||
    nl.priceMax != null ||
    nl.areaMin != null ||
    nl.areaMax != null ||
    nl.propertyTypeKeywords?.length ||
    nl.mainPropertyTypeKeywords?.length ||
    nl.featureKeys?.length ||
    nl.completionStatus ||
    nl.location ||
    nl.sortBy
  );
}

/**
 * Merge structured NL hints (beds, baths, price, property type, purpose) without location/keyword.
 * Used alongside Typesense NL so the LLM owns full-text q while known tokens become filter_by.
 */
export function mergeStructuredNaturalLanguageIntoState(
  state: Partial<SearchFilterState> & { purpose: string },
  nl: NaturalLanguageMapped,
  resolved?: {
    propertyTypeIds?: number[];
    featureIds?: number[];
    mainPropertyTypeIds?: number[];
  }
): void {
  if (nl.purpose && !state.purpose?.trim()) state.purpose = nl.purpose;
  if (nl.bedrooms?.length && state.bedrooms == null) state.bedrooms = nl.bedrooms;
  if (nl.bathrooms?.length && state.bathrooms == null) state.bathrooms = nl.bathrooms;
  if (nl.priceMin != null && state.priceMin == null) state.priceMin = nl.priceMin;
  if (nl.priceMax != null && state.priceMax == null) state.priceMax = nl.priceMax;
  if (nl.areaMin != null && state.areaMin == null) state.areaMin = nl.areaMin;
  if (nl.areaMax != null && state.areaMax == null) state.areaMax = nl.areaMax;
  if (nl.completionStatus && !state.completionStatus && !state.completionStatuses?.length) {
    state.completionStatus = nl.completionStatus;
  }
  if (nl.sortBy && !state.sortBy) state.sortBy = nl.sortBy;
  // Generic "house" + amenities: prefer amenity keywords (filter-style) over narrow type IDs
  const typeKeys =
    nl.featureKeys?.length &&
    nl.propertyTypeKeywords?.length === 1 &&
    nl.propertyTypeKeywords[0] === 'house'
      ? undefined
      : nl.propertyTypeKeywords;
  mergePropertyTypeKeywordsIntoState(state, typeKeys, typeKeys ? resolved?.propertyTypeIds : undefined);
  if (
    nl.mainPropertyTypeKeywords?.length &&
    state.mainPropertyTypeIds == null &&
    resolved?.mainPropertyTypeIds?.length
  ) {
    state.mainPropertyTypeIds = resolved.mainPropertyTypeIds;
  }
  // Amenity words → same keyword chips as filter UI (KEYWORDS / full-text).
  // Do not prefer feature_ids here — catalog amenities like garden/golf/pool are keyword-based.
  if (nl.featureKeys?.length) {
    const mapped = amenityKeysToKeywords(nl.featureKeys);
    if (mapped.length) {
      state.keywords = [...new Set([...(state.keywords ?? []), ...mapped])];
    }
  }
}

/**
 * Merge NL-mapped values into a filter state. Explicit values (from API params) override NL.
 */
export function mergeNaturalLanguageIntoState(
  state: Partial<SearchFilterState> & { purpose: string },
  nl: NaturalLanguageMapped,
  resolved?: {
    propertyTypeIds?: number[];
    featureIds?: number[];
    mainPropertyTypeIds?: number[];
  }
): void {
  if (nl.location != null && state.location == null) state.location = nl.location;
  if (nl.keyword != null) {
    state.keyword = state.keyword ? `${state.keyword} ${nl.keyword}` : nl.keyword;
  }
  mergeStructuredNaturalLanguageIntoState(state, nl, resolved);
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
 *   - caller did not opt out with nl_query=false, AND
 *   - rule parser did not already extract structured filters (avoid dual AND)
 * No q / empty q → normal search (no nl_query / nl_model_id).
 */
export function resolveNaturalLanguageSearchMode(
  q: string | undefined,
  nlModelId: string | undefined,
  nlQueryOptOut: boolean,
  options?: { hasStructuredHints?: boolean }
): { qValue: string; willUseNl: boolean } {
  const qValue = q?.trim() || '';
  const willUseNl =
    !!nlModelId && !!qValue && !nlQueryOptOut && !options?.hasStructuredHints;
  return { qValue, willUseNl };
}

async function resolveNlDbIds(nl: NaturalLanguageMapped): Promise<{
  propertyTypeIds?: number[];
  featureIds?: number[];
  mainPropertyTypeIds?: number[];
}> {
  const [propertyTypeIds, featureIds, mainPropertyTypeIds] = await Promise.all([
    nl.propertyTypeKeywords?.length
      ? resolvePropertyTypeIdsFromKeywords(nl.propertyTypeKeywords)
      : Promise.resolve([] as number[]),
    nl.featureKeys?.length
      ? resolveFeatureIdsFromKeys(nl.featureKeys)
      : Promise.resolve([] as number[]),
    nl.mainPropertyTypeKeywords?.length
      ? resolveMainPropertyTypeIdsFromKeywords(nl.mainPropertyTypeKeywords)
      : Promise.resolve([] as number[]),
  ]);
  return {
    propertyTypeIds: propertyTypeIds.length ? propertyTypeIds : undefined,
    featureIds: featureIds.length ? featureIds : undefined,
    mainPropertyTypeIds: mainPropertyTypeIds.length ? mainPropertyTypeIds : undefined,
  };
}

/**
 * Apply rule-based NL parsing to q. When structuredOnly is true (Typesense NL mode),
 * only beds/baths/price/property type/purpose are merged; location and keyword stay with the LLM.
 * Resolves type/feature IDs from DB when available (falls back to static maps / feature keys).
 */
export async function applyNaturalLanguageQuery(
  state: Partial<SearchFilterState> & { purpose: string },
  q: string,
  options: { structuredOnly: boolean }
): Promise<NaturalLanguageMapped> {
  const nl = parseNaturalLanguageQuery(q);
  const resolved = await resolveNlDbIds(nl);
  if (options.structuredOnly) {
    mergeStructuredNaturalLanguageIntoState(state, nl, resolved);
  } else {
    mergeNaturalLanguageIntoState(state, nl, resolved);
  }
  return nl;
}
