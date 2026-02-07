import type { Request, Response, NextFunction } from 'express';
import { ConversationOrchestrator } from '@/services/conversation.orchestrator';
import type { IChannelMessage } from '@/types/channel.types';
import { logger } from '@/utils/logger';

/**
 * Core Agent Controller - Exposes unified API for all channels
 * This is what the Voice Bridge and Channel Adapters will call
 */
export class AgentController {
    /**
     * POST /api/agent/process
     * Universal endpoint for processing messages from any channel
     */
    static async processMessage(req: Request, res: Response, next: NextFunction) {
        try {
            const message: IChannelMessage = req.body;

            // Validate message format
            if (!message.businessId || !message.content || !message.channel) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Missing required fields: businessId, content, channel',
                });
            }

            // Process through orchestrator
            const response = await ConversationOrchestrator.processMessage(message);

            return res.status(200).json({
                success: true,
                response: response.content,
                needsHumanTransfer: response.needsHumanTransfer,
            });
        } catch (error) {
            logger.error({ error }, 'Agent processing error');
            next(error);
        }
    }

    /**
     * GET /api/agent/health
     * Health check endpoint
     */
    static async healthCheck(req: Request, res: Response) {
        return res.status(200).json({
            status: 'healthy',
            service: 'omnichannel-ai-agent',
            timestamp: new Date().toISOString(),
        });
    }
}
