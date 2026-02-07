import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export class CustomerAuthController {
  /**
   * Register new customer (Super Admin only)
   */
  static async register(req: Request, res: Response) {
    try {
      const validated = registerSchema.parse(req.body);
      
      // Check if customer exists
      const existing = await prisma.customer.findUnique({
        where: { email: validated.email }
      });
      
      if (existing) {
        return res.status(400).json({ error: 'Customer already exists' });
      }
      
      // Hash password
      const hashedPassword = await bcrypt.hash(validated.password, 10);
      
      // Create customer
      const customer = await prisma.customer.create({
        data: {
          email: validated.email,
          password: hashedPassword,
          name: validated.name,
          phone: validated.phone,
          credits: {
            create: {
              totalCredits: 0,
              availableCredits: 0,
            }
          }
        },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          createdAt: true,
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
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  /**
   * Customer login
   */
  static async login(req: Request, res: Response) {
    try {
      const validated = loginSchema.parse(req.body);
      
      // Find customer
      const customer = await prisma.customer.findUnique({
        where: { email: validated.email }
      });
      
      if (!customer) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      if (!customer.isActive) {
        return res.status(401).json({ error: 'Account is disabled' });
      }
      
      // Verify password
      const validPassword = await bcrypt.compare(validated.password, customer.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Generate JWT
      const token = jwt.sign(
        { 
          customerId: customer.id,
          email: customer.email,
          type: 'customer'
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '7d' }
      );
      
      // Update last interaction
      await prisma.customer.update({
        where: { id: customer.id },
        data: { lastInteraction: new Date() }
      });
      
      res.json({
        message: 'Login successful',
        token,
        customer: {
          id: customer.id,
          email: customer.email,
          name: customer.name,
          phone: customer.phone,
        }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error('Login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  /**
   * Get current customer profile
   */
  static async me(req: Request, res: Response) {
    try {
      const customerId = (req as any).customer?.id;
      
      if (!customerId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: {
          credits: true,
        }
      });
      
      if (!customer) {
        return res.status(404).json({ error: 'Customer not found' });
      }
      
      res.json({
        customer: {
          id: customer.id,
          email: customer.email,
          name: customer.name,
          phone: customer.phone,
          aiConfig: customer.aiConfig,
          enabledChannels: customer.enabledChannels,
          isVerified: customer.isVerified,
          trustScore: customer.trustScore,
          credits: customer.credits,
          createdAt: customer.createdAt,
        }
      });
    } catch (error) {
      console.error('Profile error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  /**
   * Update customer profile
   */
  static async updateProfile(req: Request, res: Response) {
    try {
      const customerId = (req as any).customer?.id;
      
      if (!customerId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      
      const allowedUpdates = ['name', 'phone', 'preferences', 'aiConfig'];
      const updates: any = {};
      
      for (const key of allowedUpdates) {
        if (req.body[key] !== undefined) {
          updates[key] = req.body[key];
        }
      }
      
      const customer = await prisma.customer.update({
        where: { id: customerId },
        data: updates,
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          aiConfig: true,
          preferences: true,
          updatedAt: true,
        }
      });
      
      res.json({
        message: 'Profile updated successfully',
        customer,
      });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  /**
   * Change password
   */
  static async changePassword(req: Request, res: Response) {
    try {
      const customerId = (req as any).customer?.id;
      
      if (!customerId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword || newPassword.length < 8) {
        return res.status(400).json({ 
          error: 'Current password and new password (min 8 chars) required' 
        });
      }
      
      // Get customer with password
      const customer = await prisma.customer.findUnique({
        where: { id: customerId }
      });
      
      if (!customer) {
        return res.status(404).json({ error: 'Customer not found' });
      }
      
      // Verify current password
      const validPassword = await bcrypt.compare(currentPassword, customer.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      
      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      // Update password
      await prisma.customer.update({
        where: { id: customerId },
        data: { password: hashedPassword }
      });
      
      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
