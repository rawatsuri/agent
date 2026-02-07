-- Migration: Add service tier configuration to businesses
-- Allows admin to control AI model, TTS provider, and language per businessALTER TABLE businesses
ADD COLUMN IF NOT EXISTS ai_model VARCHAR(50) DEFAULT 'gpt-4o-mini',
ADD COLUMN IF NOT EXISTS tts_provider VARCHAR(50) DEFAULT 'azure',
ADD COLUMN IF NOT EXISTS tts_voice_id VARCHAR(100) DEFAULT 'en-US-JennyNeural',
ADD COLUMN IF NOT EXISTS default_language VARCHAR(10) DEFAULT 'en',
ADD COLUMN IF NOT EXISTS supported_languages TEXT[] DEFAULT ARRAY['en'];

-- Set defaults for existing businesses (basic tier)
UPDATE businesses
SET 
  ai_model = 'gpt-4o-mini',
  tts_provider = 'azure',
  tts_voice_id = 'en-US-JennyNeural',
  default_language = 'en',
  supported_languages = ARRAY['en']
WHERE ai_model IS NULL;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_businesses_ai_model ON businesses(ai_model);
CREATE INDEX IF NOT EXISTS idx_businesses_tts_provider ON businesses(tts_provider);
CREATE INDEX IF NOT EXISTS idx_businesses_default_language ON businesses(default_language);

-- Comments for documentation
COMMENT ON COLUMN businesses.ai_model IS 'AI model assigned by admin: gpt-3.5-turbo, gpt-4o-mini, gpt-4o, gpt-4-turbo';
COMMENT ON COLUMN businesses.tts_provider IS 'TTS provider assigned by admin: azure (cheap), elevenlabs (premium), google';
COMMENT ON COLUMN businesses.tts_voice_id IS 'Provider-specific voice ID';
COMMENT ON COLUMN businesses.default_language IS 'Primary language for AI responses (ISO 639-1 code)';
COMMENT ON COLUMN businesses.supported_languages IS 'All languages this business supports';
