-- First-frame poster for property videos (cutter output).
-- Date: 2026-08-14

ALTER TABLE property.property_videos
  ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(500);

COMMENT ON COLUMN property.property_videos.thumbnail_url IS
  'First-frame thumbnail image URL for the video.';
