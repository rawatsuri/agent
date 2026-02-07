import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { resSuccess, resError } from '@/utils/response.utils';
import { AnalyticsService } from './analytics.service';

/**
 * AnalyticsController - Handles analytics and dashboard endpoints
 */
export class AnalyticsController {
  /**
   * GET /api/analytics/dashboard
   * Main dashboard metrics
   */
  static async getDashboard(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const metrics = await AnalyticsService.getDashboardMetrics(businessId);
      resSuccess(res, metrics);
    } catch (error) {
      logger.error({ error }, 'Error fetching dashboard metrics');
      resError(res, 'Failed to fetch dashboard metrics', 500);
    }
  }

  /**
   * GET /api/analytics/costs
   * Cost breakdown by service/channel
   */
  static async getCosts(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const days = Math.min(parseInt(req.query.days as string) || 30, 90);
      const costs = await AnalyticsService.getCostBreakdown(businessId, days);
      resSuccess(res, costs);
    } catch (error) {
      logger.error({ error }, 'Error fetching cost breakdown');
      resError(res, 'Failed to fetch cost breakdown', 500);
    }
  }

  /**
   * GET /api/analytics/conversations
   * Conversation statistics
   */
  static async getConversations(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const days = Math.min(parseInt(req.query.days as string) || 30, 90);
      const stats = await AnalyticsService.getConversationStats(businessId, days);
      resSuccess(res, stats);
    } catch (error) {
      logger.error({ error }, 'Error fetching conversation stats');
      resError(res, 'Failed to fetch conversation stats', 500);
    }
  }

  /**
   * GET /api/analytics/cache
   * Cache hit rates and performance
   */
  static async getCacheStats(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const stats = await AnalyticsService.getCacheStats(businessId);
      resSuccess(res, stats);
    } catch (error) {
      logger.error({ error }, 'Error fetching cache stats');
      resError(res, 'Failed to fetch cache stats', 500);
    }
  }

  /**
   * GET /api/analytics/abuse
   * Abuse detection stats
   */
  static async getAbuseStats(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const days = Math.min(parseInt(req.query.days as string) || 30, 90);
      const stats = await AnalyticsService.getAbuseStats(businessId, days);
      resSuccess(res, stats);
    } catch (error) {
      logger.error({ error }, 'Error fetching abuse stats');
      resError(res, 'Failed to fetch abuse stats', 500);
    }
  }

  /**
   * GET /api/analytics/customers
   * Customer analytics
   */
  static async getCustomerAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const days = Math.min(parseInt(req.query.days as string) || 30, 90);
      const stats = await AnalyticsService.getCustomerAnalytics(businessId, days);
      resSuccess(res, stats);
    } catch (error) {
      logger.error({ error }, 'Error fetching customer analytics');
      resError(res, 'Failed to fetch customer analytics', 500);
    }
  }

  /**
   * GET /api/analytics/export
   * Export data (CSV/JSON)
   */
  static async exportData(req: Request, res: Response): Promise<void> {
    try {
      const businessId = req.business!.id;
      const format = (req.query.format as string) || 'json';
      const dataType = (req.query.type as string) || 'all';
      const days = Math.min(parseInt(req.query.days as string) || 30, 90);

      let data: any;

      switch (dataType) {
        case 'customers':
          data = await AnalyticsService.getCustomerAnalytics(businessId, days);
          break;
        case 'conversations':
          data = await AnalyticsService.getConversationStats(businessId, days);
          break;
        case 'costs':
          data = await AnalyticsService.getCostBreakdown(businessId, days);
          break;
        default:
          data = {
            dashboard: await AnalyticsService.getDashboardMetrics(businessId),
            costs: await AnalyticsService.getCostBreakdown(businessId, days),
            conversations: await AnalyticsService.getConversationStats(businessId, days),
            customers: await AnalyticsService.getCustomerAnalytics(businessId, days),
          };
      }

      if (format === 'csv') {
        // Simple CSV conversion for flat data structures
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="analytics-${dataType}.csv"`);
        
        // Basic CSV conversion
        const csv = this.convertToCSV(data);
        res.send(csv);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="analytics-${dataType}.json"`);
        res.json(data);
      }
    } catch (error) {
      logger.error({ error }, 'Error exporting data');
      resError(res, 'Failed to export data', 500);
    }
  }

  /**
   * Convert data to CSV format (basic implementation)
   */
  private static convertToCSV(data: any): string {
    if (!data || typeof data !== 'object') return '';
    
    // Handle arrays
    if (Array.isArray(data)) {
      if (data.length === 0) return '';
      const headers = Object.keys(data[0]);
      const rows = data.map((row) =>
        headers.map((h) => {
          const val = row[h];
          return typeof val === 'object' ? JSON.stringify(val) : val;
        }).join(',')
      );
      return [headers.join(','), ...rows].join('\n');
    }
    
    // Handle nested objects - flatten them
    const flattened: any = {};
    Object.entries(data).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        flattened[key] = JSON.stringify(value);
      } else if (typeof value === 'object' && value !== null) {
        Object.entries(value).forEach(([k, v]) => {
          flattened[`${key}_${k}`] = typeof v === 'object' ? JSON.stringify(v) : v;
        });
      } else {
        flattened[key] = value;
      }
    });
    
    const headers = Object.keys(flattened);
    const row = headers.map((h) => flattened[h]).join(',');
    return [headers.join(','), row].join('\n');
  }
}
