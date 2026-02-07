/**
 * Audit Logging Service
 * Complete audit trail for compliance and security
 */

import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import { Request } from 'express';
import { createHash } from 'crypto';

export enum AuditAction {
    // Customer Actions
    CUSTOMER_CREATED = 'CUSTOMER_CREATED',
    CUSTOMER_UPDATED = 'CUSTOMER_UPDATED',
    CUSTOMER_DELETED = 'CUSTOMER_DELETED',
    CUSTOMER_VERIFIED = 'CUSTOMER_VERIFIED',
    CUSTOMER_BLOCKED = 'CUSTOMER_BLOCKED',

    // Business Actions
    BUSINESS_CREATED = 'BUSINESS_CREATED',
    BUSINESS_UPDATED = 'BUSINESS_UPDATED',
    BUSINESS_CONFIG_CHANGED = 'BUSINESS_CONFIG_CHANGED',

    // Conversation Actions
    CONVERSATION_CREATED = 'CONVERSATION_CREATED',
    CONVERSATION_CLOSED = 'CONVERSATION_CLOSED',
    CONVERSATION_TRANSFERRED = 'CONVERSATION_TRANSFERRED',
    MESSAGE_SENT = 'MESSAGE_SENT',
    MESSAGE_DELETED = 'MESSAGE_DELETED',

    // Campaign Actions
    CAMPAIGN_CREATED = 'CAMPAIGN_CREATED',
    CAMPAIGN_UPDATED = 'CAMPAIGN_UPDATED',
    CAMPAIGN_EXECUTED = 'CAMPAIGN_EXECUTED',
    CAMPAIGN_DELETED = 'CAMPAIGN_DELETED',

    // Security Actions
    LOGIN_SUCCESS = 'LOGIN_SUCCESS',
    LOGIN_FAILED = 'LOGIN_FAILED',
    PASSWORD_CHANGED = 'PASSWORD_CHANGED',
    API_KEY_ROTATED = 'API_KEY_ROTATED',
    WEBHOOK_SECRET_CHANGED = 'WEBHOOK_SECRET_CHANGED',

    // Cost/Budget Actions
    BUDGET_LIMIT_UPDATED = 'BUDGET_LIMIT_UPDATED',
    CREDITS_PURCHASED = 'CREDITS_PURCHASED',
    BUSINESS_PAUSED = 'BUSINESS_PAUSED',
    BUSINESS_UNPAUSED = 'BUSINESS_UNPAUSED',

    // Data Export
    DATA_EXPORTED = 'DATA_EXPORTED',
    REPORT_GENERATED = 'REPORT_GENERATED',
}

export enum AuditSeverity {
    INFO = 'INFO',
    WARNING = 'WARNING',
    ERROR = 'ERROR',
    CRITICAL = 'CRITICAL',
}

export interface AuditLogEntry {
    id: string;
    timestamp: Date;
    businessId?: string;
    customerId?: string;
    userId?: string; // Clerk user ID
    action: AuditAction;
    severity: AuditSeverity;
    resource: string; // Entity type (e.g., 'customer', 'business', 'conversation')
    resourceId: string;
    description: string;
    oldValue?: any;
    newValue?: any;
    metadata?: {
        ipAddress?: string;
        userAgent?: string;
        requestId?: string;
        changes?: Array<{ field: string; old: any; new: any }>;
    };
}

export interface AuditQuery {
    businessId?: string;
    customerId?: string;
    userId?: string;
    action?: AuditAction;
    severity?: AuditSeverity;
    resource?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
}

/**
 * Audit Logger Service
 * Complete audit trail for compliance and security
 */
export class AuditLoggerService {
    /**
     * Log an audit event
     */
    static async log(params: {
        action: AuditAction;
        severity?: AuditSeverity;
        businessId?: string;
        customerId?: string;
        userId?: string;
        resource: string;
        resourceId: string;
        description: string;
        oldValue?: any;
        newValue?: any;
        req?: Request;
        metadata?: Record<string, any>;
    }): Promise<AuditLogEntry> {
        const severity = params.severity || this.inferSeverity(params.action);

        const entry = await db.auditLog.create({
            data: {
                businessId: params.businessId,
                customerId: params.customerId,
                userId: params.userId,
                action: params.action,
                severity,
                resource: params.resource,
                resourceId: params.resourceId,
                description: params.description,
                oldValue: params.oldValue || null,
                newValue: params.newValue || null,
                metadata: {
                    ...(params.req && {
                        ipAddress: this.getClientIp(params.req),
                        userAgent: params.req.headers['user-agent'],
                        requestId: (params.req as any).requestId,
                    }),
                    ...params.metadata,
                },
            },
        });

        // Log to system logger for real-time monitoring
        logger.info(
            {
                auditId: entry.id,
                action: params.action,
                resource: params.resource,
                resourceId: params.resourceId,
                severity,
                businessId: params.businessId,
            },
            `AUDIT: ${params.description}`
        );

        // Alert on critical events
        if (severity === AuditSeverity.CRITICAL) {
            await this.alertCriticalEvent(entry);
        }

        return this.mapToEntry(entry);
    }

    /**
     * Log customer creation
     */
    static async logCustomerCreated(
        customer: any,
        req?: Request
    ): Promise<AuditLogEntry> {
        return this.log({
            action: AuditAction.CUSTOMER_CREATED,
            businessId: customer.businessId,
            customerId: customer.id,
            resource: 'customer',
            resourceId: customer.id,
            description: `Customer created: ${customer.name || customer.phone || customer.email}`,
            newValue: {
                name: customer.name,
                phone: this.maskPhone(customer.phone),
                email: this.maskEmail(customer.email),
            },
            req,
        });
    }

    /**
     * Log customer update with change tracking
     */
    static async logCustomerUpdated(
        customerId: string,
        businessId: string,
        oldData: any,
        newData: any,
        req?: Request
    ): Promise<AuditLogEntry> {
        const changes = this.computeChanges(oldData, newData);

        return this.log({
            action: AuditAction.CUSTOMER_UPDATED,
            businessId,
            customerId,
            resource: 'customer',
            resourceId: customerId,
            description: `Customer updated: ${changes.map((c) => c.field).join(', ')}`,
            oldValue: oldData,
            newValue: newData,
            req,
            metadata: { changes },
        });
    }

    /**
     * Log conversation transfer
     */
    static async logConversationTransferred(
        conversationId: string,
        businessId: string,
        customerId: string,
        reason: string,
        req?: Request
    ): Promise<AuditLogEntry> {
        return this.log({
            action: AuditAction.CONVERSATION_TRANSFERRED,
            severity: AuditSeverity.WARNING,
            businessId,
            customerId,
            resource: 'conversation',
            resourceId: conversationId,
            description: `Conversation transferred to human agent: ${reason}`,
            req,
            metadata: { transferReason: reason },
        });
    }

    /**
     * Log security event
     */
    static async logSecurityEvent(params: {
        action: AuditAction.LOGIN_SUCCESS | AuditAction.LOGIN_FAILED | AuditAction.PASSWORD_CHANGED;
        userId?: string;
        businessId?: string;
        description: string;
        ipAddress?: string;
        metadata?: Record<string, any>;
    }): Promise<AuditLogEntry> {
        const severity =
            params.action === AuditAction.LOGIN_FAILED
                ? AuditSeverity.WARNING
                : params.action === AuditAction.PASSWORD_CHANGED
                    ? AuditSeverity.INFO
                    : AuditSeverity.INFO;

        return this.log({
            action: params.action,
            severity,
            businessId: params.businessId,
            userId: params.userId,
            resource: 'security',
            resourceId: params.userId || 'system',
            description: params.description,
            metadata: {
                ipAddress: params.ipAddress,
                ...params.metadata,
            },
        });
    }

    /**
     * Log data export (compliance)
    
     */
    static async logDataExport(params: {
        businessId: string;
        userId: string;
        dataType: string;
        recordCount: number;
        req?: Request;
    }): Promise<AuditLogEntry> {
        return this.log({
            action: AuditAction.DATA_EXPORTED,
            severity: AuditSeverity.INFO,
            businessId: params.businessId,
            userId: params.userId,
            resource: 'data_export',
            resourceId: `${params.businessId}-${Date.now()}`,
            description: `Data export: ${params.dataType} (${params.recordCount} records)`,
            req,
            metadata: {
                dataType: params.dataType,
                recordCount: params.recordCount,
            },
        });
    }

    /**
     * Query audit logs
     */
    static async query(params: AuditQuery): Promise<{
        entries: AuditLogEntry[];
        total: number;
        summary: {
            byAction: Record<string, number>;
            bySeverity: Record<string, number>;
        };
    }> {
        const where: any = {
            ...(params.businessId && { businessId: params.businessId }),
            ...(params.customerId && { customerId: params.customerId }),
            ...(params.userId && { userId: params.userId }),
            ...(params.action && { action: params.action }),
            ...(params.severity && { severity: params.severity }),
            ...(params.resource && { resource: params.resource }),
            ...(params.startDate &&
                params.endDate && {
                timestamp: {
                    gte: params.startDate,
                    lte: params.endDate,
                },
            }),
        };

        const [entries, total] = await Promise.all([
            db.auditLog.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                take: params.limit || 50,
                skip: params.offset || 0,
            }),
            db.auditLog.count({ where }),
        ]);

        // Calculate summary
        const byAction: Record<string, number> = {};
        const bySeverity: Record<string, number> = {};

        const allLogs = await db.auditLog.findMany({
            where,
            select: { action: true, severity: true },
        });

        for (const log of allLogs) {
            byAction[log.action] = (byAction[log.action] || 0) + 1;
            bySeverity[log.severity] = (bySeverity[log.severity] || 0) + 1;
        }

        return {
            entries: entries.map((e) => this.mapToEntry(e)),
            total,
            summary: { byAction, bySeverity },
        };
    }

    /**
     * Get audit trail for specific resource
     */
    static async getResourceHistory(
        resource: string,
        resourceId: string
    ): Promise<AuditLogEntry[]> {
        const entries = await db.auditLog.findMany({
            where: { resource, resourceId },
            orderBy: { timestamp: 'desc' },
        });

        return entries.map((e) => this.mapToEntry(e));
    }

    /**
     * Generate compliance report
     */
    static async generateComplianceReport(params: {
        businessId: string;
        startDate: Date;
        endDate: Date;
    }): Promise<{
        report: {
            totalEvents: number;
            byCategory: Record<string, number>;
            securityEvents: number;
            dataAccessEvents: number;
            criticalEvents: AuditLogEntry[];
        };
        generatedAt: Date;
        hash: string; // Tamper-proof hash
    }> {
        const entries = await db.auditLog.findMany({
            where: {
                businessId: params.businessId,
                timestamp: {
                    gte: params.startDate,
                    lte: params.endDate,
                },
            },
        });

        const byCategory: Record<string, number> = {};
        let securityEvents = 0;
        let dataAccessEvents = 0;
        const criticalEvents: AuditLogEntry[] = [];

        for (const entry of entries) {
            const category = entry.action.split('_')[0];
            byCategory[category] = (byCategory[category] || 0) + 1;

            if (entry.resource === 'security') {
                securityEvents++;
            }

            if (entry.action.includes('EXPORT') || entry.action.includes('ACCESS')) {
                dataAccessEvents++;
            }

            if (entry.severity === 'CRITICAL') {
                criticalEvents.push(this.mapToEntry(entry));
            }
        }

        const report = {
            totalEvents: entries.length,
            byCategory,
            securityEvents,
            dataAccessEvents,
            criticalEvents,
        };

        // Generate tamper-proof hash
        const reportString = JSON.stringify(report);
        const hash = createHash('sha256').update(reportString).digest('hex');

        // Log report generation
        await this.log({
            action: AuditAction.REPORT_GENERATED,
            businessId: params.businessId,
            resource: 'compliance_report',
            resourceId: `report-${Date.now()}`,
            description: `Compliance report generated for period ${params.startDate.toISOString()} to ${params.endDate.toISOString()}`,
            metadata: { hash },
        });

        return {
            report,
            generatedAt: new Date(),
            hash,
        };
    }

    /**
     * Purge old audit logs (GDPR compliance)
     */
    static async purgeOldLogs(olderThanDays: number): Promise<number> {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - olderThanDays);

        const result = await db.auditLog.deleteMany({
            where: {
                timestamp: { lt: cutoff },
                severity: { not: 'CRITICAL' }, // Keep critical events longer
            },
        });

        logger.info({ deletedCount: result.count, cutoff }, 'Purged old audit logs');

        return result.count;
    }

    /**
     * Infer severity from action type
     */
    private static inferSeverity(action: AuditAction): AuditSeverity {
        if (action.includes('DELETED') || action.includes('FAILED')) {
            return AuditSeverity.WARNING;
        }
        if (action.includes('PAUSED') || action.includes('BLOCKED')) {
            return AuditSeverity.WARNING;
        }
        if (action.includes('TRANSFERRED') || action.includes('ROTATED')) {
            return AuditSeverity.INFO;
        }
        return AuditSeverity.INFO;
    }

    /**
     * Alert on critical event
     */
    private static async alertCriticalEvent(entry: any): Promise<void> {
        logger.error(
            {
                auditId: entry.id,
                action: entry.action,
                description: entry.description,
                businessId: entry.businessId,
            },
            'CRITICAL AUDIT EVENT'
        );

        // Could integrate with Slack, PagerDuty, etc.
    }

    /**
     * Get client IP from request
     */
    private static getClientIp(req: Request): string {
        return (
            (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
            req.ip ||
            'unknown'
        );
    }

    /**
     * Mask phone number
     */
    private static maskPhone(phone?: string): string | undefined {
        if (!phone) return undefined;
        if (phone.length < 4) return phone;
        return phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4);
    }

    /**
     * Mask email address
     */
    private static maskEmail(email?: string): string | undefined {
        if (!email) return undefined;
        const [local, domain] = email.split('@');
        if (!domain) return email;
        const maskedLocal = local.length > 2 ? local[0] + '***' + local[local.length - 1] : '***';
        return `${maskedLocal}@${domain}`;
    }

    /**
     * Compute changes between old and new data
     */
    private static computeChanges(oldData: any, newData: any): Array<{ field: string; old: any; new: any }> {
        const changes: Array<{ field: string; old: any; new: any }> = [];

        const allKeys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);

        for (const key of allKeys) {
            const oldValue = oldData?.[key];
            const newValue = newData?.[key];

            if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
                changes.push({
                    field: key,
                    old: oldValue,
                    new: newValue,
                });
            }
        }

        return changes;
    }

    /**
     * Map database record to AuditLogEntry
     */
    private static mapToEntry(entry: any): AuditLogEntry {
        return {
            id: entry.id,
            timestamp: entry.timestamp,
            businessId: entry.businessId || undefined,
            customerId: entry.customerId || undefined,
            userId: entry.userId || undefined,
            action: entry.action as AuditAction,
            severity: entry.severity as AuditSeverity,
            resource: entry.resource,
            resourceId: entry.resourceId,
            description: entry.description,
            oldValue: entry.oldValue || undefined,
            newValue: entry.newValue || undefined,
            metadata: (entry.metadata as any) || undefined,
        };
    }
}
