import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Validation schemas
const createCustomerSchema = z.object({
  businessId: z.string(),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  phone: z.string().optional(),
  initialCredits: z.number().optional(),
});

const updateCustomerSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
  aiConfig: z.any().optional(),
  enabledChannels: z.array(z.enum(['VOICE', 'CHAT', 'EMAIL', 'SMS', 'TELEGRAM', 'WHATSAPP', 'INSTAGRAM'])).optional(),
});

const addCreditsSchema = z.object({
  amount: z.number().positive(),
  note: z.string().optional(),
});

export class AdminController {
  /**
   * List all customers
   */
  static async listCustomers(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const [customers, total] = await Promise.all([
        prisma.customer.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            _count: {
              select: {
                conversations: true,
              }
            }
          }
        }),
        prisma.customer.count()
      ]);

      res.json({
        customers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        }
      });
    } catch (error) {
      console.error('List customers error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get single customer details
   */
  static async getCustomer(req: Request, res: Response) {
    try {
      const id = req.params.id as string;

      const customer = await prisma.customer.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              conversations: true,
            }
          }
        }
      });

      if (!customer) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      res.json({ customer });
    } catch (error) {
      console.error('Get customer error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Create new customer (Super Admin only)
   */
  static async createCustomer(req: Request, res: Response) {
    try {
      const validated = createCustomerSchema.parse(req.body);

      // Check if customer exists
      const existing = await prisma.customer.findFirst({
        where: { email: validated.email }
      });

      if (existing) {
        return res.status(400).json({ error: 'Customer already exists' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(validated.password, 10);

      // Create customer with credits
      const customer = await prisma.customer.create({
        data: {
          businessId: validated.businessId,
          email: validated.email,
          password: hashedPassword,
          name: validated.name,
          phone: validated.phone,
          credits: {
            create: {
              totalCredits: validated.initialCredits || 0,
              availableCredits: validated.initialCredits || 0,
            }
          }
        },
        include: {
          credits: true,
        }
      });

      res.status(201).json({
        message: 'Customer created successfully',
        customer,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error('Create customer error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Update customer
   */
  static async updateCustomer(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const validated = updateCustomerSchema.parse(req.body);

      const customer = await prisma.customer.update({
        where: { id },
        data: validated,
      });

      res.json({
        message: 'Customer updated successfully',
        customer,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error('Update customer error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Delete customer
   */
  static async deleteCustomer(req: Request, res: Response) {
    try {
      const id = req.params.id as string;

      await prisma.customer.delete({
        where: { id }
      });

      res.json({ message: 'Customer deleted successfully' });
    } catch (error) {
      console.error('Delete customer error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Add credits to customer
   */
  static async addCredits(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const validated = addCreditsSchema.parse(req.body);

      const credit = await prisma.customerCredit.upsert({
        where: { customerId: id },
        create: {
          customerId: id,
          totalCredits: validated.amount,
          availableCredits: validated.amount,
        },
        update: {
          totalCredits: { increment: validated.amount },
          availableCredits: { increment: validated.amount },
        }
      });

      res.json({
        message: 'Credits added successfully',
        credit,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error('Add credits error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get all costs (admin view)
   */
  static async getCosts(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const customerId = req.query.customerId as string;
      const skip = (page - 1) * limit;

      const where = customerId ? { customerId } : {};

      const [costs, total] = await Promise.all([
        prisma.costLog.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            customer: {
              select: {
                id: true,
                email: true,
                name: true,
              }
            }
          }
        }),
        prisma.costLog.count({ where })
      ]);

      // Calculate totals
      const totalCost = await prisma.costLog.aggregate({
        where,
        _sum: { cost: true }
      });

      res.json({
        costs,
        summary: {
          totalCost: totalCost._sum.cost || 0,
          totalRecords: total,
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        }
      });
    } catch (error) {
      console.error('Get costs error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get dashboard analytics
   */
  static async getAnalytics(req: Request, res: Response) {
    try {
      const startDate = req.query.startDate
        ? new Date(req.query.startDate as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

      const endDate = req.query.endDate
        ? new Date(req.query.endDate as string)
        : new Date();

      // Get stats
      const [
        totalCustomers,
        activeCustomers,
        totalConversations,
        totalMessages,
        totalCost,
      ] = await Promise.all([
        prisma.customer.count(),
        prisma.customer.count({ where: { isActive: true } }),
        prisma.conversation.count({
          where: { startedAt: { gte: startDate, lte: endDate } }
        }),
        prisma.message.count({
          where: { createdAt: { gte: startDate, lte: endDate } }
        }),
        prisma.costLog.aggregate({
          where: { createdAt: { gte: startDate, lte: endDate } },
          _sum: { cost: true }
        }),
      ]);

      // Cost by service
      const costByService = await prisma.costLog.groupBy({
        by: ['service'],
        where: { createdAt: { gte: startDate, lte: endDate } },
        _sum: { cost: true },
      });

      // Cost by channel
      const costByChannel = await prisma.costLog.groupBy({
        by: ['channel'],
        where: { createdAt: { gte: startDate, lte: endDate } },
        _sum: { cost: true },
      });

      res.json({
        overview: {
          totalCustomers,
          activeCustomers,
          totalConversations,
          totalMessages,
          totalCost: totalCost._sum.cost || 0,
        },
        costByService,
        costByChannel,
        period: {
          startDate,
          endDate,
        }
      });
    } catch (error) {
      console.error('Get analytics error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get/Update global AI configuration
   */
  static async getGlobalAIConfig(req: Request, res: Response) {
    try {
      // Return default AI configuration
      res.json({
        config: {
          defaultModel: 'gpt-4o-mini',
          defaultTemperature: 0.7,
          maxTokens: 1000,
          defaultLanguage: 'en',
          supportedLanguages: ['en', 'hi', 'es', 'fr'],
        }
      });
    } catch (error) {
      console.error('Get AI config error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
