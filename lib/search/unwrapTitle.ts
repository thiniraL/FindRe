/**
 * Some listings store title_translations as { en: { title: "..." } }
 * instead of { en: "..." }. `->>'en'` then serializes the object to text.
 */
export function unwrapTitle(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const title = (parsed as { title?: unknown }).title;
        if (typeof title === 'string' && title.trim()) return title;
      }
    } catch {
      // keep original
    }
  }
  return value;
}

export function pickLocalizedTitle(
  lang: string,
  titleEn?: string | null,
  titleAr?: string | null
): string | null {
  const primary = unwrapTitle(lang === 'ar' ? titleAr : titleEn);
  return primary ?? unwrapTitle(lang === 'ar' ? titleEn : titleAr);
}

/** SQL that reads a flat or nested title_translations value for one language. */
export function sqlTitleForLang(langExpr: string): string {
  return `CASE
      WHEN jsonb_typeof(p.title_translations->${langExpr}) = 'object'
        THEN NULLIF(p.title_translations->${langExpr}->>'title', '')
      ELSE NULLIF(p.title_translations->>${langExpr}, '')
    END`;
}

export function sqlLocalizedTitle(langParam: string, fallback = "'en'"): string {
  return `COALESCE(
    ${sqlTitleForLang(langParam)},
    ${sqlTitleForLang(fallback)}
  )`;
}
