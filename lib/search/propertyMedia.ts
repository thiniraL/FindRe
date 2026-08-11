/**
 * Zip Typesense URL + media-type parallel arrays into API media items.
 * Older docs without media-type fields default to "image".
 */
export type PropertyMediaItem = {
  url: string;
  mediaType: 'image' | 'video';
};

export function normalizeMediaType(
  mediaType: string | null | undefined
): 'image' | 'video' {
  return mediaType === 'video' ? 'video' : 'image';
}

export function toMediaItem(
  url: string | null | undefined,
  mediaType: string | null | undefined
): PropertyMediaItem | null {
  if (typeof url !== 'string' || !url) return null;
  return {
    url,
    mediaType: normalizeMediaType(mediaType),
  };
}

export function zipMediaUrls(
  urls: string[] | null | undefined,
  mediaTypes: string[] | null | undefined
): PropertyMediaItem[] {
  const list = Array.isArray(urls) ? urls : [];
  const types = Array.isArray(mediaTypes) ? mediaTypes : [];
  return list
    .filter((url): url is string => typeof url === 'string' && url.length > 0)
    .map((url, index) => ({
      url,
      mediaType: normalizeMediaType(types[index]),
    }));
}

/** Legacy string URL helpers (keep old API fields unchanged). */
export function mediaItemUrl(
  item: PropertyMediaItem | null | undefined
): string | null {
  return item?.url ?? null;
}

export function mediaItemUrls(items: PropertyMediaItem[]): string[] {
  return items.map((item) => item.url);
}

/** Legacy additionalImageUrls: images only — videos belong in additionalMedia. */
export function imageMediaUrls(items: PropertyMediaItem[]): string[] {
  return items.filter((item) => item.mediaType === 'image').map((item) => item.url);
}

/** TEMP: inject a known video at additionalMedia order 4 for client load testing. Remove after QA. */
export const TEMP_TEST_VIDEO_URL =
  'https://samplelib.com/mp4/sample-5s.mp4';
const TEMP_TEST_VIDEO_ORDER = 4;

export function withTempTestVideo<T extends { url: string; mediaType: 'image' | 'video' }>(
  items: T[]
): T[] {
  const index = TEMP_TEST_VIDEO_ORDER - 1;
  const next = [...items];
  const video = {
    url: TEMP_TEST_VIDEO_URL,
    mediaType: 'video' as const,
  };
  if (next.length > index) {
    next[index] = { ...next[index], ...video };
    return next;
  }
  next.push({ ...(next[0] ?? {}), ...video } as T);
  return next;
}
