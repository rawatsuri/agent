import fetch from 'node-fetch';
import { logger } from '@/utils/logger';

/**
 * ElevenLabs Text-to-Speech Service
 * Premium quality voice synthesis
 * 
 * Pricing: ~$0.00030 per character (much more expensive than Azure)
 * Use for premium/enterprise clients only
 */

export interface ElevenLabsVoice {
    voice_id: string;
    name: string;
    category: string;
    labels: Record<string, string>;
}

export interface TTSOptions {
    voiceId: string;
    model?: string;
    stability?: number;
    similarityBoost?: number;
    style?: number;
    useSpeakerBoost?: boolean;
}

export class ElevenLabsTTSService {
    private apiKey: string;
    private baseUrl = 'https://api.elevenlabs.io/v1';

    constructor() {
        this.apiKey = process.env.ELEVENLABS_API_KEY || '';

        if (!this.apiKey) {
            logger.warn('ELEVENLABS_API_KEY not set - ElevenLabs TTS will not work');
        }
    }

    /**
     * Synthesize text to speech
     */
    async synthesize(text: string, options: TTSOptions): Promise<Buffer> {
        if (!this.apiKey) {
            throw new Error('ElevenLabs API key not configured');
        }

        try {
            const response = await fetch(
                `${this.baseUrl}/text-to-speech/${options.voiceId}`,
                {
                    method: 'POST',
                    headers: {
                        'Accept': 'audio/mpeg',
                        'Content-Type': 'application/json',
                        'xi-api-key': this.apiKey,
                    },
                    body: JSON.stringify({
                        text,
                        model_id: options.model || 'eleven_monolingual_v1',
                        voice_settings: {
                            stability: options.stability || 0.5,
                            similarity_boost: options.similarityBoost || 0.75,
                            style: options.style || 0,
                            use_speaker_boost: options.useSpeakerBoost !== false,
                        },
                    }),
                }
            );

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            logger.info({
                voiceId: options.voiceId,
                textLength: text.length,
                audioSize: buffer.length
            }, 'ElevenLabs TTS generated');

            return buffer;
        } catch (error) {
            logger.error({ error, voiceId: options.voiceId }, 'ElevenLabs TTS failed');
            throw error;
        }
    }

    /**
     * Get available voices
     */
    async getVoices(): Promise<ElevenLabsVoice[]> {
        if (!this.apiKey) {
            throw new Error('ElevenLabs API key not configured');
        }

        try {
            const response = await fetch(`${this.baseUrl}/voices`, {
                headers: {
                    'xi-api-key': this.apiKey,
                },
            });

            if (!response.ok) {
                throw new Error(`ElevenLabs API error: ${response.status}`);
            }

            const data: any = await response.json();
            return data.voices || [];
        } catch (error) {
            logger.error({ error }, 'Failed to fetch ElevenLabs voices');
            throw error;
        }
    }

    /**
     * Calculate cost for text
     * ElevenLabs pricing: ~$0.30 per 1000 characters
     */
    calculateCost(text: string): number {
        const characters = text.length;
        const costPerChar = 0.0003; // $0.30 per 1000 chars
        return characters * costPerChar;
    }
}

// Export singleton instance
export const elevenLabsTTS = new ElevenLabsTTSService();
