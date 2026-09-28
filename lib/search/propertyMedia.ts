/**
 * Zip Typesense URL + media-type + thumbnail parallel arrays into API media items.
 * Older docs without media-type fields default to "image".
 * Thumbnail is only attached when mediaType is video.
 */
export type PropertyMediaItem = {
  url: string;
  mediaType: 'image' | 'video';
  /** First-frame poster; only present for videos. */
  thumbnailUrl?: string;
};

export function normalizeMediaType(
  mediaType: string | null | undefined
): 'image' | 'video' {
  return mediaType === 'video' ? 'video' : 'image';
}

function optionalThumbnailUrl(
  thumbnailUrl: string | null | undefined
): string | undefined {
  if (typeof thumbnailUrl !== 'string') return undefined;
  const trimmed = thumbnailUrl.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function toMediaItem(
  url: string | null | undefined,
  mediaType: string | null | undefined,
  thumbnailUrl?: string | null
): PropertyMediaItem | null {
  if (typeof url !== 'string' || !url) return null;
  const type = normalizeMediaType(mediaType);
  const thumb = type === 'video' ? optionalThumbnailUrl(thumbnailUrl) : undefined;
  return {
    url,
    mediaType: type,
    ...(thumb ? { thumbnailUrl: thumb } : {}),
  };
}

export function zipMediaUrls(
  urls: string[] | null | undefined,
  mediaTypes: string[] | null | undefined,
  thumbnailUrls?: string[] | null
): PropertyMediaItem[] {
  const list = Array.isArray(urls) ? urls : [];
  const types = Array.isArray(mediaTypes) ? mediaTypes : [];
  const thumbs = Array.isArray(thumbnailUrls) ? thumbnailUrls : [];
  return list
    .filter((url): url is string => typeof url === 'string' && url.length > 0)
    .map((url, index) =>
      toMediaItem(url, types[index], thumbs[index])
    )
    .filter((item): item is PropertyMediaItem => item != null);
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

function sameMedia(
  a: PropertyMediaItem,
  b: PropertyMediaItem
): boolean {
  return a.mediaType === b.mediaType && a.url === b.url;
}

/** Max media items returned by search (primary + additional). */
export const SEARCH_MEDIA_MAX = 10;

/**
 * Primary first, then remaining media in display order (excluding primary).
 * Prefers full `all_*` arrays when present; falls back to carousel additional.
 * Caps total returned items to `maxTotal` (default SEARCH_MEDIA_MAX = 10).
 */
export function primaryThenAllMedia(opts: {
  primaryUrl?: string | null;
  primaryMediaType?: string | null;
  primaryThumbnailUrl?: string | null;
  allUrls?: string[] | null;
  allMediaTypes?: string[] | null;
  allThumbnailUrls?: string[] | null;
  additionalUrls?: string[] | null;
  additionalMediaTypes?: string[] | null;
  additionalThumbnailUrls?: string[] | null;
  /** Max primary + additional items (default SEARCH_MEDIA_MAX = 10). */
  maxTotal?: number;
}): {
  primaryMedia: PropertyMediaItem | null;
  additionalMedia: PropertyMediaItem[];
} {
  const maxTotal =
    typeof opts.maxTotal === 'number' && opts.maxTotal > 0
      ? Math.floor(opts.maxTotal)
      : SEARCH_MEDIA_MAX;

  const hintedPrimary = toMediaItem(
    opts.primaryUrl,
    opts.primaryMediaType,
    opts.primaryThumbnailUrl
  );
  const allMedia = zipMediaUrls(
    opts.allUrls,
    opts.allMediaTypes,
    opts.allThumbnailUrls
  );

  let primaryMedia: PropertyMediaItem | null;
  let additionalMedia: PropertyMediaItem[];

  if (allMedia.length > 0) {
    const resolvedPrimary =
      (hintedPrimary &&
        allMedia.find((item) => sameMedia(item, hintedPrimary))) ??
      hintedPrimary ??
      allMedia[0] ??
      null;
    primaryMedia = resolvedPrimary;
    additionalMedia = resolvedPrimary
      ? allMedia.filter((item) => !sameMedia(item, resolvedPrimary))
      : allMedia;
  } else {
    primaryMedia = hintedPrimary;
    additionalMedia = zipMediaUrls(
      opts.additionalUrls,
      opts.additionalMediaTypes,
      opts.additionalThumbnailUrls
    );
  }

  const ordered = primaryMedia
    ? [primaryMedia, ...additionalMedia]
    : additionalMedia;
  const capped = ordered.slice(0, maxTotal);
  return {
    primaryMedia: capped[0] ?? null,
    additionalMedia: capped.slice(1),
  };
}
