/**
 * Helpers for GET/POST /api/search/count: purpose label from param and Typesense count-only.
 */

import type { SearchFilterState } from './buildFilterQuery';
import { buildFilterBy, buildSearchQuery } from './buildFilterQuery';
import { PROPERTIES_QUERY_BY } from './typesenseSchema';
import { typesenseSearch } from './typesense';
import { PURPOSE_WORDS_SET, SEARCH_STOPWORDS } from './naturalLanguageQuery';

const PURPOSE_KEY_TO_LABEL: Record<string, string> = {
  for_sale: 'For Sale',
  for_rent: 'For Rent',
};

/** Derive button label from purpose param (e.g. for_sale → "For Sale"). No DB. */
export function getPurposeLabel(purposeKey: string): string {
  const key = purposeKey?.trim().toLowerCase().replace(/\s+/g, '_') || 'for_sale';
  return PURPOSE_KEY_TO_LABEL[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function stripStopwords(s: string | undefined): string | undefined {
  if (!s?.trim()) return s;
  const cleaned = s
    .split(/\s+/)
    .filter((w) => !PURPOSE_WORDS_SET.has(w.toLowerCase()) && !SEARCH_STOPWORDS.has(w.toLowerCase()))
    .join(' ')
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export type SearchCountNlOptions = {
  useNlQuery: boolean;
  rawQ?: string;
  nlModelId?: string;
};

/**
 * Run Typesense with the same filters as search but per_page=0; returns total matching count.
 */
export async function runSearchCount(
  filterState: SearchFilterState,
  nlOptions?: SearchCountNlOptions
): Promise<number> {
  const state = { ...filterState };
  if (state.location) state.location = stripStopwords(state.location);
  if (state.keyword) state.keyword = stripStopwords(state.keyword);

  const useNl = nlOptions?.useNlQuery && nlOptions?.nlModelId;
  const q = useNl ? (nlOptions.rawQ?.trim() || '*') : buildSearchQuery(state);
  const filterBy = buildFilterBy(state);

  const resp = await typesenseSearch<{ property_id: string }>({
    collection: 'properties',
    q,
    queryBy: PROPERTIES_QUERY_BY,
    filterBy: filterBy ?? undefined,
    sortBy: 'updated_at:desc',
    page: 1,
    perPage: 0,
    ...(useNl && {
      nlQuery: true,
      nlModelId: nlOptions!.nlModelId,
    }),
  });

  return resp.found;
}

/** Build resultButtonLabel from purpose label and count. */
export function buildResultButtonLabel(purposeLabel: string, totalCount: number): string {
  const word = totalCount === 1 ? 'property' : 'properties';
  return `${purposeLabel} – ${totalCount.toLocaleString()} ${word}`;
}
