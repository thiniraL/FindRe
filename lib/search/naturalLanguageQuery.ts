/**
 * Typesense Natural Language Search helpers.
 * Free-text `q` is sent to Typesense with nl_query + nl_model_id; no local rule parser.
 */

/**
 * q string sent to Typesense when Natural Language Search is on.
 */
export function getTypesenseNlQuery(rawQ: string): string {
  const trimmed = rawQ?.trim() || '';
  return trimmed.length > 0 ? trimmed : '*';
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
