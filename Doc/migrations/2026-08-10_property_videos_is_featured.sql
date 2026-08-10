-- Add is_featured to property.property_videos so Featured media can mix
-- images and videos (max 5) under one shared display_order.
-- Date: 2026-08-10

ALTER TABLE property.property_videos
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN property.property_videos.is_featured IS
  'When true, video is in the featured media set (shared with PROPERTY_IMAGES; max 5 mixed items). Order is display_order across both tables.';
