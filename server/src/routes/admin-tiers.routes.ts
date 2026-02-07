import express from 'express';
import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import { authenticateAdmin } from '@/middleware/auth.middleware';

const router = express.Router();

/**
 * Admin APIs for Service Tier Management
 * Controls AI model, TTS provider, and language configuration per business
 */

// Get business service tier configuration
router.get('/business/:id/tier', authenticateAdmin, async (req, res) => {
    try {
        const business = await db.business.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                name: true,
                aiModel: true,
                ttsProvider: true,
                ttsVoiceId: true,
                defaultLanguage: true,
                supportedLanguages: true,
                enabledChannels: true,
                credits: {
                    select: {
                        monthlyBudget: true,
                        currentMonthSpend: true,
                        availableCredits: true
                    }
                }
            }
        });

        if (!business) {
            return res.status(404).json({ error: 'Business not found' });
        }

        res.json(business);
    } catch (error) {
        logger.error({ error }, 'Error fetching business tier');
        res.status(500).json({ error: 'Failed to fetch business tier' });
    }
});

// Update business service tier
router.patch('/business/:id/tier', authenticateAdmin, async (req, res) => {
    try {
        const {
            aiModel,
            ttsProvider,
            ttsVoiceId,
            defaultLanguage,
            supportedLanguages
        } = req.body;

        // Validate AI model
        const validAIModels = ['gpt-3.5-turbo', 'gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-4'];
        if (aiModel && !validAIModels.includes(aiModel)) {
            return res.status(400).json({
                error: 'Invalid AI model',
                validModels: validAIModels
            });
        }

        // Validate TTS provider
        const validTTSProviders = ['azure', 'elevenlabs', 'google'];
        if (ttsProvider && !validTTSProviders.includes(ttsProvider)) {
            return res.status(400).json({
                error: 'Invalid TTS provider',
                validProviders: validTTSProviders
            });
        }

        // Validate language codes
        const validLanguages = ['en', 'hi', 'es', 'fr', 'ar', 'zh', 'de', 'pt', 'ru', 'ja'];
        if (defaultLanguage && !validLanguages.includes(defaultLanguage)) {
            return res.status(400).json({
                error: 'Invalid language code',
                validLanguages
            });
        }

        if (supportedLanguages) {
            const invalidLangs = supportedLanguages.filter((lang: string) => !validLanguages.includes(lang));
            if (invalidLangs.length > 0) {
                return res.status(400).json({
                    error: 'Invalid language codes',
                    invalidLanguages: invalidLangs,
                    validLanguages
                });
            }
        }

        const updated = await db.business.update({
            where: { id: req.params.id },
            data: {
                ...(aiModel && { aiModel }),
                ...(ttsProvider && { ttsProvider }),
                ...(ttsVoiceId && { ttsVoiceId }),
                ...(defaultLanguage && { defaultLanguage }),
                ...(supportedLanguages && { supportedLanguages })
            },
            select: {
                id: true,
                name: true,
                aiModel: true,
                ttsProvider: true,
                ttsVoiceId: true,
                defaultLanguage: true,
                supportedLanguages: true
            }
        });

        logger.info({
            businessId: req.params.id,
            businessName: updated.name,
            aiModel: updated.aiModel,
            ttsProvider: updated.ttsProvider,
            defaultLanguage: updated.defaultLanguage
        }, 'Service tier updated by admin');

        res.json({
            success: true,
            business: updated
        });
    } catch (error) {
        logger.error({ error }, 'Error updating business tier');
        res.status(500).json({ error: 'Failed to update tier' });
    }
});

// Preset tier configurations
const TIER_PRESETS = {
    basic: {
        aiModel: 'gpt-3.5-turbo',
        ttsProvider: 'azure',
        ttsVoiceId: 'en-US-JennyNeural',
        defaultLanguage: 'en',
        supportedLanguages: ['en']
    },
    standard: {
        aiModel: 'gpt-4o-mini',
        ttsProvider: 'azure',
        ttsVoiceId: 'en-US-JennyNeural',
        defaultLanguage: 'en',
        supportedLanguages: ['en', 'hi']
    },
    premium: {
        aiModel: 'gpt-4o',
        ttsProvider: 'elevenlabs',
        ttsVoiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel - ElevenLabs
        defaultLanguage: 'en',
        supportedLanguages: ['en', 'hi', 'es', 'fr']
    },
    enterprise: {
        aiModel: 'gpt-4-turbo',
        ttsProvider: 'elevenlabs',
        ttsVoiceId: '21m00Tcm4TlvDq8ikWAM',
        defaultLanguage: 'en',
        supportedLanguages: ['en', 'hi', 'es', 'fr', 'ar', 'zh']
    }
};

// Apply preset tier to business
router.post('/business/:id/tier/preset/:preset', authenticateAdmin, async (req, res) => {
    try {
        const { preset } = req.params;

        if (!TIER_PRESETS[preset as keyof typeof TIER_PRESETS]) {
            return res.status(400).json({
                error: 'Invalid preset',
                validPresets: Object.keys(TIER_PRESETS)
            });
        }

        const tierConfig = TIER_PRESETS[preset as keyof typeof TIER_PRESETS];

        const updated = await db.business.update({
            where: { id: req.params.id },
            data: tierConfig,
            select: {
                id: true,
                name: true,
                aiModel: true,
                ttsProvider: true,
                defaultLanguage: true,
                supportedLanguages: true
            }
        });

        logger.info({
            businessId: req.params.id,
            businessName: updated.name,
            preset
        }, 'Preset tier applied');

        res.json({
            success: true,
            preset,
            business: updated
        });
    } catch (error) {
        logger.error({ error }, 'Error applying preset tier');
        res.status(500).json({ error: 'Failed to apply preset' });
    }
});

// Get available tier presets
router.get('/tiers/presets', authenticateAdmin, async (req, res) => {
    res.json({
        presets: TIER_PRESETS,
        description: {
            basic: 'Budget-friendly: GPT-3.5 + Azure TTS, English only',
            standard: 'Balanced: GPT-4o-mini + Azure TTS, 2 languages',
            premium: 'High quality: GPT-4o + ElevenLabs, 4 languages',
            enterprise: 'Best: GPT-4-turbo + ElevenLabs Premium, 6+ languages'
        },
        estimatedCost: {
            basic: '$20-50/month',
            standard: '$100-200/month',
            premium: '$500-2000/month',
            enterprise: '$5000-20000/month'
        }
    });
});

// Get available voices for a TTS provider
router.get('/tts/:provider/voices', authenticateAdmin, async (req, res) => {
    const { provider } = req.params;

    // This would typically call the actual TTS provider API
    // For now, return sample data
    const voices: Record<string, any> = {
        azure: [
            { id: 'en-US-JennyNeural', name: 'Jenny (US English - Female)', language: 'en' },
            { id: 'en-US-GuyNeural', name: 'Guy (US English - Male)', language: 'en' },
            { id: 'hi-IN-SwaraNeural', name: 'Swara (Hindi - Female)', language: 'hi' },
            { id: 'es-ES-ElviraNeural', name: 'Elvira (Spanish - Female)', language: 'es' },
            { id: 'fr-FR-DeniseNeural', name: 'Denise (French - Female)', language: 'fr' },
        ],
        elevenlabs: [
            { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (Premium)', language: 'en' },
            { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi (Premium)', language: 'en' },
            { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (Premium)', language: 'en' },
        ],
        google: [
            { id: 'en-US-Wavenet-A', name: 'Wavenet A (US English)', language: 'en' },
            { id: 'hi-IN-Wavenet-A', name: 'Wavenet A (Hindi)', language: 'hi' },
        ]
    };

    res.json({
        provider,
        voices: voices[provider] || []
    });
});

// ============================================
// Voice Provider Configuration (Twilio/Exotel)
// ============================================

// Get business voice provider configuration
router.get('/business/:id/voice-provider', authenticateAdmin, async (req, res) => {
    try {
        const business = await db.business.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                name: true,
                voiceProvider: true,
                twilioPhoneNumber: true,
                exotelPhoneNumber: true,
            }
        });

        if (!business) {
            return res.status(404).json({ error: 'Business not found' });
        }

        res.json({
            business: {
                id: business.id,
                name: business.name,
                voiceProvider: business.voiceProvider,
                twilioPhoneNumber: business.twilioPhoneNumber,
                exotelPhoneNumber: business.exotelPhoneNumber,
            },
            providers: {
                twilio: {
                    enabled: !!business.twilioPhoneNumber,
                    coverage: 'Global (180+ countries)',
                    costPerMin: '$0.02-0.05'
                },
                exotel: {
                    enabled: !!business.exotelPhoneNumber,
                    coverage: 'India, UAE, SEA',
                    costPerMin: '₹0.8-1.0 (30-40% cheaper for India)'
                }
            }
        });
    } catch (error) {
        logger.error({ error }, 'Error fetching voice provider config');
        res.status(500).json({ error: 'Failed to fetch voice provider' });
    }
});

// Update business voice provider
router.patch('/business/:id/voice-provider', authenticateAdmin, async (req, res) => {
    try {
        const {
            voiceProvider,
            twilioPhoneNumber,
            exotelPhoneNumber
        } = req.body;

        // Validate voice provider
        const validProviders = ['twilio', 'exotel'];
        if (voiceProvider && !validProviders.includes(voiceProvider)) {
            return res.status(400).json({
                error: 'Invalid voice provider',
                validProviders
            });
        }

        // Validate phone number format if provided
        if (twilioPhoneNumber && !twilioPhoneNumber.startsWith('+')) {
            return res.status(400).json({
                error: 'Twilio phone number must start with + (E.164 format)',
                example: '+14155551234'
            });
        }

        const updated = await db.business.update({
            where: { id: req.params.id },
            data: {
                ...(voiceProvider && { voiceProvider }),
                ...(twilioPhoneNumber !== undefined && { twilioPhoneNumber }),
                ...(exotelPhoneNumber !== undefined && { exotelPhoneNumber })
            },
            select: {
                id: true,
                name: true,
                voiceProvider: true,
                twilioPhoneNumber: true,
                exotelPhoneNumber: true
            }
        });

        logger.info({
            businessId: req.params.id,
            businessName: updated.name,
            voiceProvider: updated.voiceProvider
        }, 'Voice provider updated by admin');

        res.json({
            success: true,
            business: updated
        });
    } catch (error) {
        logger.error({ error }, 'Error updating voice provider');
        res.status(500).json({ error: 'Failed to update voice provider' });
    }
});

// Get available voice providers and their details
router.get('/voice-providers', authenticateAdmin, async (req, res) => {
    res.json({
        providers: [
            {
                id: 'twilio',
                name: 'Twilio',
                coverage: 'Global (180+ countries)',
                features: [
                    'Native Vocode integration',
                    'Programmable voice',
                    'Call recording',
                    'Global phone numbers'
                ],
                pricing: {
                    inbound: '$0.0085/min',
                    outbound: '$0.02-0.05/min (varies by country)',
                    phoneNumber: '$1/month (US), varies by country'
                },
                bestFor: 'Global businesses, US/EU customers',
                setupUrl: 'https://console.twilio.com/'
            },
            {
                id: 'exotel',
                name: 'Exotel',
                coverage: 'India, UAE, Southeast Asia',
                features: [
                    'India-optimized infrastructure',
                    'Lower latency for Indian calls',
                    'INR billing (no forex)',
                    'Local Indian numbers'
                ],
                pricing: {
                    inbound: '₹0.5-0.8/min',
                    outbound: '₹0.8-1.0/min',
                    phoneNumber: 'Included in plans'
                },
                costSavings: '30-40% cheaper than Twilio for India',
                bestFor: 'India-focused businesses',
                setupUrl: 'https://exotel.com/'
            }
        ],
        recommendation: {
            india: 'exotel',
            global: 'twilio',
            hybrid: 'Use both - Exotel for India, Twilio for rest of world'
        }
    });
});

// Bulk update voice provider for multiple businesses
router.post('/voice-provider/bulk-update', authenticateAdmin, async (req, res) => {
    try {
        const { businessIds, voiceProvider } = req.body;

        if (!businessIds || !Array.isArray(businessIds) || businessIds.length === 0) {
            return res.status(400).json({ error: 'businessIds array required' });
        }

        const validProviders = ['twilio', 'exotel'];
        if (!validProviders.includes(voiceProvider)) {
            return res.status(400).json({
                error: 'Invalid voice provider',
                validProviders
            });
        }

        const result = await db.business.updateMany({
            where: { id: { in: businessIds } },
            data: { voiceProvider }
        });

        logger.info({
            count: result.count,
            voiceProvider,
            businessIds
        }, 'Bulk voice provider update');

        res.json({
            success: true,
            updatedCount: result.count,
            voiceProvider
        });
    } catch (error) {
        logger.error({ error }, 'Error in bulk voice provider update');
        res.status(500).json({ error: 'Failed to bulk update' });
    }
});

// Get voice provider statistics
router.get('/voice-provider/stats', authenticateAdmin, async (req, res) => {
    try {
        const [twilioCount, exotelCount, totalCalls] = await Promise.all([
            db.business.count({ where: { voiceProvider: 'twilio' } }),
            db.business.count({ where: { voiceProvider: 'exotel' } }),
            db.costLog.aggregate({
                where: { channel: 'VOICE' },
                _sum: { cost: true },
                _count: true
            })
        ]);

        res.json({
            businessesByProvider: {
                twilio: twilioCount,
                exotel: exotelCount
            },
            totalVoiceCalls: totalCalls._count,
            totalVoiceCost: totalCalls._sum.cost || 0
        });
    } catch (error) {
        logger.error({ error }, 'Error fetching voice provider stats');
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

export default router;

