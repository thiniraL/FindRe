import { AppError } from '@/lib/utils/errors';

type TypesenseConfig = {
  baseUrl: string;
  apiKey: string;
};

function getTypesenseConfig(): TypesenseConfig {
  const host = process.env.TYPESENSE_HOST;
  const protocol = process.env.TYPESENSE_PROTOCOL || 'https';
  const port = process.env.TYPESENSE_PORT;
  const apiKey = process.env.TYPESENSE_API_KEY;

  if (!host) {
    throw new AppError('Missing TYPESENSE_HOST', 500, 'TYPESENSE_CONFIG_MISSING');
  }
  if (!apiKey) {
    throw new AppError('Missing TYPESENSE_API_KEY', 500, 'TYPESENSE_CONFIG_MISSING');
  }

  const baseUrl = port ? `${protocol}://${host}:${port}` : `${protocol}://${host}`;
  return { baseUrl, apiKey };
}

function withApiKey(headers?: HeadersInit): HeadersInit {
  const { apiKey } = getTypesenseConfig();
  return {
    'X-TYPESENSE-API-KEY': apiKey,
    ...(headers || {}),
  };
}

export async function typesenseFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const { baseUrl } = getTypesenseConfig();
  const url = `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await fetch(url, {
    ...init,
    headers: withApiKey(init?.headers),
    // Next.js: avoid caching by default for search
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AppError(
      `Typesense error (${res.status}) ${text || res.statusText}`,
      502,
      'TYPESENSE_ERROR'
    );
  }

  return (await res.json()) as T;
}

export type TypesenseSearchResponse<TDoc> = {
  found: number;
  out_of: number;
  page: number;
  request_params: Record<string, unknown>;
  search_time_ms: number;
  /** Present when nl_query was used: LLM-parsed interpretation of the query */
  parsed_nl_query?: Record<string, unknown>;
  /** Present when nl_query was used: generated filter_by, sort_by, etc. */
  generated_params?: Record<string, unknown>;
  hits: Array<{
    document: TDoc;
    highlight?: Record<string, unknown>;
    highlights?: unknown[];
    text_match?: number;
    text_match_info?: Record<string, unknown>;
  }>;
};

export async function typesenseSearch<TDoc>(options: {
  collection: string;
  q: string;
  queryBy: string;
  filterBy?: string;
  sortBy?: string;
  page: number;
  perPage: number;
  /** Use Typesense Natural Language Search (LLM parses q into filters/sorts). */
  nlQuery?: boolean;
  /** Typesense NL model id (e.g. gemini-model). Required when nlQuery is true. */
  nlModelId?: string;
}): Promise<TypesenseSearchResponse<TDoc>> {
  // Always POST /multi_search — GET query strings max out at 4000 chars (long _eval sort_by).
  const searchBody: Record<string, string | number | boolean> = {
    collection: options.collection,
    q: options.q,
    query_by: options.queryBy,
    page: options.page,
    per_page: options.perPage,
  };
  if (options.filterBy) searchBody.filter_by = options.filterBy;
  if (options.sortBy) searchBody.sort_by = options.sortBy;
  if (options.nlQuery === true && options.nlModelId) {
    searchBody.nl_query = true;
    searchBody.nl_model_id = options.nlModelId;
    if (process.env.TYPESENSE_NL_QUERY_DEBUG === 'true') {
      searchBody.nl_query_debug = true;
    }
  }

  const raw = await typesenseFetch<
    TypesenseSearchResponse<TDoc> & { results?: TypesenseSearchResponse<TDoc>[] }
  >('/multi_search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ searches: [searchBody] }),
  });

  if (Array.isArray(raw.results) && raw.results[0]) {
    return raw.results[0];
  }
  return raw;
}

type NlSearchParams = {
  q?: string;
  filter_by?: string;
  sort_by?: string;
};

function nlParamString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Typesense NL still keyword-searches the original sentence even when the LLM
 * returns q:"". Parse with nl_query, then search again using generated q / filters.
 */
export async function typesenseNlSearch<TDoc>(options: {
  collection: string;
  q: string;
  queryBy: string;
  filterBy?: string;
  sortBy?: string;
  page: number;
  perPage: number;
  nlModelId: string;
}): Promise<TypesenseSearchResponse<TDoc>> {
  const parsed = await typesenseSearch<TDoc>({
    ...options,
    page: 1,
    perPage: 0,
    nlQuery: true,
    nlModelId: options.nlModelId,
  });

  const generated = (parsed.parsed_nl_query?.generated_params ?? {}) as NlSearchParams;
  const augmented = (parsed.parsed_nl_query?.augmented_params ?? {}) as NlSearchParams;

  const q = nlParamString(generated.q) || '*';
  const filterBy =
    nlParamString(augmented.filter_by) ||
    nlParamString(generated.filter_by) ||
    options.filterBy;
  const sortBy = nlParamString(generated.sort_by) || options.sortBy;

  const results = await typesenseSearch<TDoc>({
    collection: options.collection,
    q,
    queryBy: options.queryBy,
    filterBy: filterBy || undefined,
    sortBy: sortBy || undefined,
    page: options.page,
    perPage: options.perPage,
  });

  if (parsed.parsed_nl_query) {
    results.parsed_nl_query = parsed.parsed_nl_query;
  }
  results.search_time_ms =
    (parsed.search_time_ms || 0) + (results.search_time_ms || 0);

  return results;
}

type TypesenseSearchParams = {
  collection: string;
  q: string;
  queryBy: string;
  filterBy?: string;
  sortBy?: string;
  page: number;
  perPage: number;
};

/**
 * Multi-search with union=true so multiple keyword queries are OR'd
 * (beach OR golf), with shared filter_by / pagination.
 */
export async function typesenseMultiSearchUnion<TDoc>(
  searches: TypesenseSearchParams[]
): Promise<TypesenseSearchResponse<TDoc>> {
  if (searches.length === 0) {
    return {
      found: 0,
      out_of: 0,
      page: 1,
      request_params: {},
      search_time_ms: 0,
      hits: [],
    };
  }
  if (searches.length === 1) {
    return typesenseSearch<TDoc>(searches[0]);
  }

  const toSearchBody = (withUnion: boolean) => ({
    ...(withUnion ? { union: true } : {}),
    searches: searches.map((s) => ({
      collection: s.collection,
      q: s.q,
      query_by: s.queryBy,
      filter_by: s.filterBy,
      sort_by: s.sortBy,
      page: s.page,
      per_page: s.perPage === 0 ? 250 : s.perPage,
    })),
  });

  const mergeResults = (
    results: TypesenseSearchResponse<TDoc>[]
  ): TypesenseSearchResponse<TDoc> => {
    const byId = new Map<string, TypesenseSearchResponse<TDoc>['hits'][0]>();
    for (const r of results) {
      for (const hit of r.hits ?? []) {
        const id = String((hit.document as { property_id?: string }).property_id ?? '');
        if (id && !byId.has(id)) byId.set(id, hit);
      }
    }
    const mergedHits = Array.from(byId.values());
    const page = searches[0].page;
    const perPage = searches[0].perPage;
    // Count-only (per_page=0): return unique found, no hits
    if (perPage === 0) {
      return {
        found: mergedHits.length,
        out_of: results[0]?.out_of ?? mergedHits.length,
        page: 1,
        request_params: {},
        search_time_ms: results.reduce((a, r) => a + (r.search_time_ms || 0), 0),
        hits: [],
      };
    }
    const start = (page - 1) * perPage;
    return {
      found: mergedHits.length,
      out_of: results[0]?.out_of ?? mergedHits.length,
      page,
      request_params: {},
      search_time_ms: results.reduce((a, r) => a + (r.search_time_ms || 0), 0),
      hits: mergedHits.slice(start, start + perPage),
    };
  };

  const parseMulti = (
    raw: TypesenseSearchResponse<TDoc> & { results?: TypesenseSearchResponse<TDoc>[] }
  ): TypesenseSearchResponse<TDoc> => {
    if (Array.isArray(raw.hits) && typeof raw.found === 'number') {
      return raw;
    }
    if (Array.isArray(raw.results) && raw.results.length > 0) {
      return mergeResults(raw.results);
    }
    return {
      found: 0,
      out_of: 0,
      page: searches[0].page,
      request_params: {},
      search_time_ms: 0,
      hits: [],
    };
  };

  try {
    const raw = await typesenseFetch<
      TypesenseSearchResponse<TDoc> & { results?: TypesenseSearchResponse<TDoc>[] }
    >('/multi_search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toSearchBody(true)),
    });
    return parseMulti(raw);
  } catch {
    // Typesense without union support — merge unique hits client-side
    const raw = await typesenseFetch<
      TypesenseSearchResponse<TDoc> & { results?: TypesenseSearchResponse<TDoc>[] }
    >('/multi_search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toSearchBody(false)),
    });
    return parseMulti(raw);
  }
}

