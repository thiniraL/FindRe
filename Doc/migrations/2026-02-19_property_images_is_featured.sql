-- Add is_featured to property.PROPERTY_IMAGES (featured set, max 5; first by display_order is primary).
-- Date: 2026-02-19

ALTER TABLE property.PROPERTY_IMAGES
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN property.PROPERTY_IMAGES.is_featured IS 'When true, image is in the featured set (max 5). First featured by display_order is the primary image.';
