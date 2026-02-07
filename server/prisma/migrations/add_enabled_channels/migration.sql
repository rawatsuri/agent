-- Migration: Add enabled channels to Business model
-- This allows per-business channel configuration

-- Add enabledChannels column to businesses table
ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS enabled_channels channel[] DEFAULT ARRAY['CHAT']::channel[];

-- Set all existing businesses to have all channels enabled (grandfathered)
-- This ensures existing businesses maintain full access after migration
UPDATE businesses 
SET enabled_channels = ARRAY['CHAT', 'VOICE', 'EMAIL', 'SMS', 'WHATSAPP', 'TELEGRAM', 'INSTAGRAM']::channel[]
WHERE enabled_channels IS NULL OR array_length(enabled_channels, 1) IS NULL;

-- Add index for faster channel queries (optional, for performance)
CREATE INDEX IF NOT EXISTS idx_businesses_enabled_channels ON businesses USING GIN (enabled_channels);

-- Comments
COMMENT ON COLUMN businesses.enabled_channels IS 'Channels that this business has purchased and can use. Admin-configured based on client package.';
