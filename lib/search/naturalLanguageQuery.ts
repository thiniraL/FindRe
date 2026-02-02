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
  bedroomsMin?: number;
  bedroomsMax?: number;
  bathroomsMin?: number;
  bathroomsMax?: number;
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

/** Property type words → canonical key for filter */
const PROPERTY_TYPE_MAP: Record<string, string> = {
  villa: 'villa',
  villas: 'villa',
  apartment: 'apartment',
  apartments: 'apartment',
  flat: 'apartment',
  flats: 'apartment',
  townhouse: 'townhouse',
  townhouses: 'townhouse',
  penthouse: 'penthouse',
  penthouses: 'penthouse',
  house: 'house',
  houses: 'house',
  office: 'office',
  offices: 'office',
  retail: 'retail',
  warehouse: 'warehouse',
  land: 'land',
  residential: 'residential',
  commercial: 'commercial',
  studio: 'studio',
  studios: 'studio',
};

/** Canonical property type key → Typesense property_type_id (matches mvp seed order: villa, apartment, townhouse, penthouse, studio). Others left unmapped. */
const PROPERTY_TYPE_KEY_TO_ID: Record<string, number> = {
  villa: 1,
  apartment: 2,
  townhouse: 3,
  penthouse: 4,
  studio: 5,
};

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
      result.bedroomsMin = n;
      result.bedroomsMax = n;
    }
  }
  if (STUDIO_REGEX.test(text)) {
    result.bedroomsMin = 0;
    result.bedroomsMax = 0;
  }

  // --- Baths ---
  BATHS_REGEX.lastIndex = 0;
  const bathMatch = BATHS_REGEX.exec(text);
  if (bathMatch) {
    const n = parseInt(bathMatch[1], 10);
    if (Number.isFinite(n)) {
      result.bathroomsMin = n;
      result.bathroomsMax = n;
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
      if (/^[A-Za-z]/.test(last) && !PROPERTY_TYPE_MAP[last.toLowerCase()] && !FEATURE_MAP[last.toLowerCase()]) {
        result.location = lastTwo.length <= 30 ? lastTwo : last;
      }
    }
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

  // --- Property type keywords ---
  const typeSet = new Set<string>();
  for (const w of words) {
    const v = PROPERTY_TYPE_MAP[w];
    if (v) typeSet.add(v);
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
  for (const key of Object.keys(PROPERTY_TYPE_MAP)) {
    residual = residual.replace(new RegExp(`\\b${key.replace(/\s+/g, '\\s+')}\\b`, 'gi'), ' ');
  }
  residual = residual.replace(/\s+/g, ' ').trim();
  if (residual && residual.length > 1) result.keyword = residual;

  return result;
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
  if (nl.bedroomsMin != null && state.bedroomsMin == null) state.bedroomsMin = nl.bedroomsMin;
  if (nl.bedroomsMax != null && state.bedroomsMax == null) state.bedroomsMax = nl.bedroomsMax;
  if (nl.bathroomsMin != null && state.bathroomsMin == null) state.bathroomsMin = nl.bathroomsMin;
  if (nl.bathroomsMax != null && state.bathroomsMax == null) state.bathroomsMax = nl.bathroomsMax;
  if (nl.priceMin != null && state.priceMin == null) state.priceMin = nl.priceMin;
  if (nl.priceMax != null && state.priceMax == null) state.priceMax = nl.priceMax;
  if (nl.featureKeys?.length) {
    const existing = new Set(state.featureKeys ?? []);
    nl.featureKeys.forEach((k) => existing.add(k));
    state.featureKeys = Array.from(existing);
  }
  if (nl.propertyTypeKeywords?.length && state.propertyTypeIds == null) {
    const ids = nl.propertyTypeKeywords
      .map((k) => PROPERTY_TYPE_KEY_TO_ID[k])
      .filter((id): id is number => id != null && Number.isFinite(id));
    const unique = [...new Set(ids)];
    if (unique.length) state.propertyTypeIds = unique;
  }
}
