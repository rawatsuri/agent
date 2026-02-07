import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';

// Singleton Prisma Client with pgvector extension support
class DatabaseService {
    private static instance: PrismaClient;

    static getInstance(): PrismaClient {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new PrismaClient({
                log: [
                    { level: 'query', emit: 'event' },
                    { level: 'error', emit: 'stdout' },
                    { level: 'warn', emit: 'stdout' },
                ],
            });

            // Log queries in development
            if (process.env.NODE_ENV === 'development') {
                DatabaseService.instance.$on('query' as never, (e: any) => {
                    logger.debug({ query: e.query, params: e.params }, 'Database Query');
                });
            }

            // Graceful shutdown
            process.on('beforeExit', async () => {
                await DatabaseService.instance.$disconnect();
            });
        }

        return DatabaseService.instance;
    }
}

export const db = DatabaseService.getInstance();
