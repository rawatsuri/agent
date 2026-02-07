import { Router, Request, Response, NextFunction } from 'express';
import { db } from '@/config/database';
import { MemoryService } from '@/features/memory/memory.service';
import { logger } from '@/utils/logger';

const router = Router();

/**
 * Voice Context API
 * Provides full context loading for low-latency voice calls
 * SECURITY: Protected by API key middleware
 */

// API Key middleware for voice bridge authentication
const validateApiKey = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'] as string;
    const expectedKey = process.env.INTERNAL_API_KEY || process.env.NODE_API_KEY;

    if (!expectedKey) {
        logger.warn('INTERNAL_API_KEY not configured - rejecting request');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    if (!apiKey || apiKey !== expectedKey) {
        logger.warn({
            ip: req.ip,
            path: req.path
        }, 'Unauthorized voice API access attempt');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
};

// Apply API key validation to all routes
router.use(validateApiKey);

/**
 * GET /api/agent/full-context
 * Get full context for a voice call (customer + memories + business)
 * Called ONCE at call start for low-latency Vocode conversations
 */
router.get('/full-context', async (req, res) => {
    try {
        const phoneNumber = req.query.phoneNumber as string;

        if (!phoneNumber) {
            return res.status(400).json({ error: 'phoneNumber required' });
        }

        // Find customer by phone
        const customer = await db.customer.findFirst({
            where: { phone: phoneNumber },
            select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                preferences: true,
                trustScore: true,
                isVerified: true,
                businessId: true,
            }
        });

        if (!customer) {
            logger.info({ phoneNumber: maskPhone(phoneNumber) }, 'No customer found for phone, returning defaults');
            return res.json({
                customer: { name: 'Customer', trustScore: 50 },
                business: { name: 'Business' },
                memories: [],
                recentConversations: [],
                welcomeMessage: 'Hello! How can I help you today?',
                voiceId: 'en-US-JennyNeural'
            });
        }

        // Get business config
        const business = await db.business.findUnique({
            where: { id: customer.businessId },
            select: {
                id: true,
                name: true,
                config: true,
                aiModel: true,
                ttsProvider: true,
                ttsVoiceId: true,
                defaultLanguage: true,
                voiceProvider: true,
            }
        });

        // Get relevant memories (parallel)
        const [memories, recentConversations] = await Promise.all([
            // Search for relevant memories (last 5)
            MemoryService.searchMemories(customer.id, 'general context', 5),
            // Get recent conversation summaries
            db.conversation.findMany({
                where: {
                    customerId: customer.id,
                    channel: {
                        not: 'VOICE'
                    }
                },
                orderBy: { updatedAt: 'desc' },
                take: 3,
                select: {
                    id: true,
                    channel: true,
                    updatedAt: true,
                    messages: {
                        take: 2,
                        orderBy: { createdAt: 'desc' },
                        select: { content: true, role: true }
                    }
                }
            })
        ]);

        // Build context response
        const config = (business?.config as any) || {};

        const fullContext = {
            customer: {
                id: customer.id,
                name: customer.name || 'Customer',
                phone: customer.phone,
                trustScore: customer.trustScore,
                isVerified: customer.isVerified,
                preferences: customer.preferences,
            },
            business: {
                id: business?.id,
                name: business?.name || 'Business',
                customPrompt: config.customPrompt || '',
                personality: config.personality || 'professional and helpful',
            },
            memories: memories.map((m: { content: string; source?: string }) => ({
                content: m.content,
                source: m.source,
            })),
            recentConversations: recentConversations.map((c: { channel: string; messages: Array<{ role: string; content: string }> }) => ({
                channel: c.channel,
                summary: c.messages.map((m: { role: string; content: string }) => `${m.role}: ${m.content.substring(0, 50)}`).join(' | '),
            })),
            welcomeMessage: config.voiceWelcomeMessage || config.welcomeMessage || 'Hello! How can I help you today?',
            voiceId: business?.ttsVoiceId || 'en-US-JennyNeural',
            language: business?.defaultLanguage || 'en',
        };

        logger.info({
            phoneNumber: maskPhone(phoneNumber),
            customerId: customer.id,
            memoriesCount: memories.length,
        }, 'Full context loaded for voice call');

        return res.json(fullContext);

    } catch (error) {
        logger.error({ 
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined,
            phoneNumber: maskPhone(phoneNumber)
        }, 'Failed to load full context');
        return res.status(500).json({ 
            error: 'Failed to load context',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /api/agent/create-conversation
 * Create a conversation record for a voice call
 * Called at call start to enable transcript saving later
 */
router.post('/create-conversation', async (req, res) => {
    try {
        const { callSid, phoneNumber, businessId, customerId } = req.body;

        if (!callSid) {
            return res.status(400).json({ error: 'callSid required' });
        }

        // Check if conversation already exists
        const existing = await db.conversation.findFirst({
            where: {
                metadata: {
                    path: ['callSid'],
                    equals: callSid
                }
            }
        });

        if (existing) {
            return res.json({ conversationId: existing.id, existing: true });
        }

        // Find or create customer
        let custId = customerId;
        if (!custId && phoneNumber) {
            const customer = await db.customer.findFirst({
                where: { phone: phoneNumber }
            });
            custId = customer?.id;
        }

        if (!custId || !businessId) {
            logger.warn({ callSid, phoneNumber: maskPhone(phoneNumber) }, 'Missing customer or business ID');
            return res.json({ conversationId: null, warning: 'Could not create conversation - missing IDs' });
        }

        // Create conversation
        const conversation = await db.conversation.create({
            data: {
                customerId: custId,
                businessId: businessId,
                channel: 'VOICE',
                status: 'ACTIVE',
                metadata: { callSid },
            }
        });

        logger.info({
            callSid,
            conversationId: conversation.id,
            phoneNumber: maskPhone(phoneNumber)
        }, 'Voice conversation created');

        return res.json({ conversationId: conversation.id, created: true });

    } catch (error) {
        logger.error({ error }, 'Failed to create conversation');
        return res.status(500).json({ error: 'Failed to create conversation' });
    }
});

/**
 * POST /api/agent/save-transcript
 * Save full call transcript to database
 */
router.post('/save-transcript', async (req, res) => {
    try {
        const { callSid, transcript } = req.body;

        if (!callSid || !transcript) {
            return res.status(400).json({ error: 'callSid and transcript required' });
        }

        // Find the conversation by callSid (stored in metadata)
        const conversation = await db.conversation.findFirst({
            where: {
                metadata: {
                    path: ['callSid'],
                    equals: callSid
                }
            }
        });

        if (conversation) {
            // Save each transcript entry as a message
            for (const entry of transcript) {
                await db.message.create({
                    data: {
                        conversationId: conversation.id,
                        role: entry.role === 'user' ? 'USER' : 'ASSISTANT',
                        content: entry.content,
                        channel: 'VOICE',
                        createdAt: new Date(entry.timestamp * 1000),
                    }
                });
            }

            // Mark conversation as completed
            await db.conversation.update({
                where: { id: conversation.id },
                data: { status: 'COMPLETED' }
            });

            // Extract and save key memories from transcript
            const fullText = transcript.map((t: { content: string }) => t.content).join(' ');
            if (fullText.length > 50 && conversation) {
                // Save conversation summary as memory
                await MemoryService.addMemory(
                    conversation.customerId,
                    `Voice call summary: ${fullText.substring(0, 200)}...`,
                    { source: 'voice_call', conversationId: conversation.id }
                );
            }

            logger.info({ callSid, entriesCount: transcript.length }, 'Transcript saved');
        } else {
            logger.warn({ callSid }, 'Conversation not found for transcript');
        }

        return res.json({ success: true });

    } catch (error) {
        logger.error({ error }, 'Failed to save transcript');
        return res.status(500).json({ error: 'Failed to save transcript' });
    }
});

/**
 * POST /api/agent/report-call-cost
 * Report call cost for billing
 */
router.post('/report-call-cost', async (req, res) => {
    try {
        const { callSid, durationSeconds, phoneNumber, provider } = req.body;

        if (!callSid || durationSeconds === undefined) {
            return res.status(400).json({ error: 'callSid and durationSeconds required' });
        }

        // Find conversation and customer
        const conversation = await db.conversation.findFirst({
            where: {
                metadata: {
                    path: ['callSid'],
                    equals: callSid
                }
            },
            include: {
                customer: {
                    select: { businessId: true }
                }
            }
        });

        if (!conversation) {
            logger.warn({ callSid }, 'Conversation not found for cost logging');
            return res.json({ success: false, warning: 'Conversation not found' });
        }

        // Calculate cost (estimate)
        const isExotel = provider === 'exotel' || (phoneNumber && phoneNumber.startsWith('+91'));
        const costPerMinute = isExotel ? 0.012 : 0.04; // Exotel ~₹1/min, Twilio ~₹3.5/min
        const cost = (durationSeconds / 60) * costPerMinute;

        // Log cost
        await db.costLog.create({
            data: {
                businessId: conversation.customer.businessId,
                customerId: conversation.customerId,
                conversationId: conversation.id,
                service: isExotel ? 'EXOTEL_VOICE' : 'TWILIO_VOICE',
                channel: 'VOICE',
                cost: cost,
                tokensUsed: 0,
                durationSeconds: durationSeconds,
                metadata: {
                    callSid,
                    provider: isExotel ? 'exotel' : 'twilio',
                    costPerMinute,
                },
            }
        });

        logger.info({
            callSid,
            durationSeconds,
            cost,
            provider: isExotel ? 'exotel' : 'twilio',
        }, 'Voice call cost logged');

        return res.json({ success: true, cost });

    } catch (error) {
        logger.error({ error }, 'Failed to report call cost');
        return res.status(500).json({ error: 'Failed to report cost' });
    }
});

/**
 * GET /api/agent/business-config
 * Get business voice provider configuration
 */
router.get('/business-config', async (req, res) => {
    try {
        const phoneNumber = req.query.phoneNumber as string;

        if (!phoneNumber) {
            return res.status(400).json({ error: 'phoneNumber required' });
        }

        // Find customer by phone to get business
        const customer = await db.customer.findFirst({
            where: { phone: phoneNumber },
            select: { businessId: true }
        });

        if (!customer) {
            return res.json({ voiceProvider: 'twilio' }); // Default
        }

        const business = await db.business.findUnique({
            where: { id: customer.businessId },
            select: {
                voiceProvider: true,
                twilioPhoneNumber: true,
                exotelPhoneNumber: true,
            }
        });

        return res.json({
            voiceProvider: business?.voiceProvider || 'twilio',
            twilioPhoneNumber: business?.twilioPhoneNumber,
            exotelPhoneNumber: business?.exotelPhoneNumber,
        });

    } catch (error) {
        logger.error({ error }, 'Failed to get business config');
        return res.status(500).json({ error: 'Failed to get config' });
    }
});

// Helper to mask phone numbers in logs
function maskPhone(phone: string): string {
    if (!phone || phone.length < 6) return '****';
    return phone.slice(0, 4) + '****' + phone.slice(-2);
}

export default router;

