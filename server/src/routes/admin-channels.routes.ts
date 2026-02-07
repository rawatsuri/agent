import express from 'express';
import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import { authenticateAdmin } from '@/middleware/auth.middleware';

const router = express.Router();

/**
 * Admin APIs for Channel Management
 */

// Get business details including channels
router.get('/business/:id', authenticateAdmin, async (req, res) => {
    try {
        const business = await db.business.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                industry: true,
                enabledChannels: true,
                active: true,
                createdAt: true,
                credits: {
                    select: {
                        totalCredits: true,
                        availableCredits: true,
                        monthlyBudget: true,
                        currentMonthSpend: true
                    }
                }
            }
        });

        if (!business) {
            return res.status(404).json({ error: 'Business not found' });
        }

        res.json(business);
    } catch (error) {
        logger.error({ error }, 'Error fetching business');
        res.status(500).json({ error: 'Failed to fetch business' });
    }
});

// Update business enabled channels
router.patch('/business/:id/channels', authenticateAdmin, async (req, res) => {
    try {
        const { enabledChannels } = req.body;

        if (!Array.isArray(enabledChannels)) {
            return res.status(400).json({
                error: 'Invalid input',
                message: 'enabledChannels must be an array'
            });
        }

        // Validate channels
        const validChannels = ['VOICE', 'CHAT', 'EMAIL', 'SMS', 'TELEGRAM', 'WHATSAPP', 'INSTAGRAM'];
        const invalidChannels = enabledChannels.filter(ch => !validChannels.includes(ch));

        if (invalidChannels.length > 0) {
            return res.status(400).json({
                error: 'Invalid channels',
                message: `Invalid channels: ${invalidChannels.join(', ')}`,
                validChannels
            });
        }

        const updated = await db.business.update({
            where: { id: req.params.id },
            data: { enabledChannels },
            select: {
                id: true,
                name: true,
                enabledChannels: true
            }
        });

        logger.info({
            businessId: req.params.id,
            businessName: updated.name,
            enabledChannels
        }, 'Business channels updated');

        res.json({
            success: true,
            business: updated
        });
    } catch (error) {
        logger.error({ error }, 'Error updating business channels');
        res.status(500).json({ error: 'Failed to update channels' });
    }
});

// Create new business (onboarding)
router.post('/business', authenticateAdmin, async (req, res) => {
    try {
        const {
            name,
            email,
            phone,
            industry,
            enabledChannels = ['CHAT'], // Default to chat only
            monthlyBudget = 50,
            initialCredits = 0
        } = req.body;

        if (!name) {
            return res.status(400).json({
                error: 'Validation error',
                message: 'Business name is required'
            });
        }

        // Create business with credits in a transaction
        const business = await db.business.create({
            data: {
                name,
                email,
                phone,
                industry,
                enabledChannels,
                credits: {
                    create: {
                        totalCredits: initialCredits,
                        availableCredits: initialCredits,
                        monthlyBudget
                    }
                }
            },
            include: {
                credits: true
            }
        });

        logger.info({
            businessId: business.id,
            name,
            enabledChannels
        }, 'New business created');

        res.status(201).json({
            success: true,
            business
        });
    } catch (error) {
        logger.error({ error }, 'Error creating business');
        res.status(500).json({ error: 'Failed to create business' });
    }
});

// List all businesses with channel info
router.get('/businesses', authenticateAdmin, async (req, res) => {
    try {
        const businesses = await db.business.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                enabledChannels: true,
                active: true,
                createdAt: true,
                credits: {
                    select: {
                        availableCredits: true,
                        currentMonthSpend: true
                    }
                },
                _count: {
                    select: {
                        customers: true,
                        conversations: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        res.json({
            total: businesses.length,
            businesses
        });
    } catch (error) {
        logger.error({ error }, 'Error listing businesses');
        res.status(500).json({ error: 'Failed to list businesses' });
    }
});

// Enable/disable specific channel for a business
router.post('/business/:id/channels/:channel/enable', authenticateAdmin, async (req, res) => {
    try {
        const { id, channel } = req.params;
        const channelUpper = channel.toUpperCase();

        const business = await db.business.findUnique({
            where: { id },
            select: { enabledChannels: true, name: true }
        });

        if (!business) {
            return res.status(404).json({ error: 'Business not found' });
        }

        if (business.enabledChannels.includes(channelUpper as any)) {
            return res.json({
                message: 'Channel already enabled',
                enabledChannels: business.enabledChannels
            });
        }

        const updated = await db.business.update({
            where: { id },
            data: {
                enabledChannels: [...business.enabledChannels, channelUpper]
            },
            select: { id: true, name: true, enabledChannels: true }
        });

        logger.info({
            businessId: id,
            businessName: business.name,
            channel: channelUpper
        }, 'Channel enabled');

        res.json({
            success: true,
            message: `${channelUpper} channel enabled`,
            business: updated
        });
    } catch (error) {
        logger.error({ error }, 'Error enabling channel');
        res.status(500).json({ error: 'Failed to enable channel' });
    }
});

router.post('/business/:id/channels/:channel/disable', authenticateAdmin, async (req, res) => {
    try {
        const { id, channel } = req.params;
        const channelUpper = channel.toUpperCase();

        const business = await db.business.findUnique({
            where: { id },
            select: { enabledChannels: true, name: true }
        });

        if (!business) {
            return res.status(404).json({ error: 'Business not found' });
        }

        const updated = await db.business.update({
            where: { id },
            data: {
                enabledChannels: business.enabledChannels.filter(ch => ch !== channelUpper)
            },
            select: { id: true, name: true, enabledChannels: true }
        });

        logger.info({
            businessId: id,
            businessName: business.name,
            channel: channelUpper
        }, 'Channel disabled');

        res.json({
            success: true,
            message: `${channelUpper} channel disabled`,
            business: updated
        });
    } catch (error) {
        logger.error({ error }, 'Error disabling channel');
        res.status(500).json({ error: 'Failed to disable channel' });
    }
});

export default router;
