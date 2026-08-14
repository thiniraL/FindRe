/**
 * Typesense Natural Language Search helpers.
 * Free-text `q` is parsed by Typesense NL, then searched again with generated q / filters.
 *
 * Frontend NL queries often include currency symbols ($, €, £, د.إ). Those are mapped
 * to ISO codes before Typesense so NL / query_by can match `currency_code`.
 */

/** Master currencies (mvp.sql) — longest symbols first. */
const CURRENCY_SYMBOL_TO_CODE: ReadonlyArray<{ symbol: string; code: string }> = [
  { symbol: 'ر.ع.', code: 'OMR' },
  { symbol: 'د.إ', code: 'AED' },
  { symbol: 'ر.س', code: 'SAR' },
  { symbol: 'د.ك', code: 'KWD' },
  { symbol: 'ر.ق', code: 'QAR' },
  { symbol: '.د.ب', code: 'BHD' },
  { symbol: '€', code: 'EUR' },
  { symbol: '£', code: 'GBP' },
  { symbol: '$', code: 'USD' },
];

/**
 * Replace currency symbols (and common aliases) with ISO codes.
 * e.g. "villas under $500k" → "villas under USD 500k"
 *      "apartments below €200000" → "apartments below EUR 200000"
 */
export function mapCurrencySymbolsToText(q: string): string {
  let out = q;

  for (const { symbol, code } of CURRENCY_SYMBOL_TO_CODE) {
    if (!out.includes(symbol)) continue;
    out = out.split(symbol).join(` ${code} `);
  }

  // Common UAE typed aliases (not ISO symbols)
  out = out.replace(/\bDhs?\b/gi, ' AED ');

  return out.replace(/\s+/g, ' ').trim();
}

/**
 * q string sent to Typesense when Natural Language Search is on.
 * Maps currency symbols → ISO text before Typesense NL.
 */
export function getTypesenseNlQuery(rawQ: string): string {
  const trimmed = rawQ?.trim() || '';
  if (!trimmed) return '*';
  return mapCurrencySymbolsToText(trimmed) || '*';
}

/**
 * Decide whether to call Typesense NL.
 * nl_query=true when:
 *   - TYPESENSE_NL_MODEL_ID is set, AND
 *   - q is non-empty, AND
 *   - caller did not opt out with nl_query=false
 * Empty/missing q → normal search (no nl_query / nl_model_id).
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
