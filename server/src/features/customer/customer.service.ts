import { db } from '@/config/database';
import { Customer } from '@prisma/client';
import type { IChannelMessage } from '@/types/channel.types';
import { logger } from '@/utils/logger';

/**
 * CustomerService - Handles customer identification across all channels
 * Implements the "zero friction" model: Auto-create customers on first interaction
 */
export class CustomerService {
    /**
     * Identify or create a customer from an incoming message
     */
    static async identifyOrCreate(
        message: IChannelMessage,
    ): Promise<Customer> {
        const { businessId, customerIdentifier } = message;
        const { phone, email, telegramId, whatsappId, instagramId } =
            customerIdentifier;

        // Try to find existing customer by any identifier
        let customer = await this.findExisting(businessId, customerIdentifier);

        if (customer) {
            // Update identifiers if new ones provided
            const updates: any = {};
            if (phone && !customer.phone) updates.phone = phone;
            if (email && !customer.email) updates.email = email;

            if (Object.keys(updates).length > 0) {
                customer = await db.customer.update({
                    where: { id: customer.id },
                    data: updates,
                });
            }

            return customer;
        }

        // Create new customer (zero friction auto-creation)
        customer = await db.customer.create({
            data: {
                businessId,
                phone,
                email,
                metadata: {
                    telegramId,
                    whatsappId,
                    instagramId,
                    firstSeenChannel: message.channel,
                    firstSeenAt: new Date(),
                },
            },
        });

        logger.info(
            { customerId: customer.id, businessId },
            'New customer auto-created',
        );

        return customer;
    }

    /**
     * Find existing customer by any available identifier
     */
    private static async findExisting(
        businessId: string,
        identifiers: IChannelMessage['customerIdentifier'],
    ): Promise<Customer | null> {
        const { phone, email } = identifiers;

        // Try phone first (most reliable for voice/SMS)
        if (phone) {
            const customer = await db.customer.findUnique({
                where: {
                    businessId_phone: {
                        businessId,
                        phone,
                    },
                },
            });
            if (customer) return customer;
        }

        // Try email
        if (email) {
            const customer = await db.customer.findUnique({
                where: {
                    businessId_email: {
                        businessId,
                        email,
                    },
                },
            });
            if (customer) return customer;
        }

        return null;
    }

    /**
     * Merge duplicate customers (deduplication logic)
     */
    static async mergeDuplicates(
        primaryId: string,
        duplicateId: string,
    ): Promise<void> {
        // Transfer all conversations to primary
        await db.conversation.updateMany({
            where: { customerId: duplicateId },
            data: { customerId: primaryId },
        });

        // Transfer all memories
        await db.memory.updateMany({
            where: { customerId: duplicateId },
            data: { customerId: primaryId },
        });

        // Merge metadata from duplicate into primary
        const [primary, duplicate] = await Promise.all([
            db.customer.findUnique({ where: { id: primaryId } }),
            db.customer.findUnique({ where: { id: duplicateId } }),
        ]);

        if (primary && duplicate) {
            const mergedMetadata = {
                ...primary.metadata,
                ...duplicate.metadata,
                mergedFrom: duplicateId,
                mergedAt: new Date(),
            };

            await db.customer.update({
                where: { id: primaryId },
                data: { metadata: mergedMetadata },
            });
        }

        // Delete duplicate
        await db.customer.delete({ where: { id: duplicateId } });

        logger.info({ primaryId, duplicateId }, 'Customers merged');
    }
}
