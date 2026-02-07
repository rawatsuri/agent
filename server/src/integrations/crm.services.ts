/**
 * CRM Integrations
 * 
 * 1. CRM Connector Base Interface
 * 2. Salesforce Integration
 * 3. HubSpot Integration
 * 4. Zoho CRM Integration
 * 5. Outbound Webhooks
 */

import { db } from '@/config/database';
import { CostTrackerService } from '@/features/cost-control/cost-tracker.service';
import { logger } from '@/utils/logger';

export interface CRMConfig {
    id: string;
    businessId: string;
    provider: 'SALESFORCE' | 'HUBSPOT' | 'ZOHO' | 'CUSTOM';
    enabled: boolean;
    apiKey?: string;
    apiSecret?: string;
    accessToken?: string;
    refreshToken?: string;
    instanceUrl?: string;
    settings: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

export interface SyncResult {
    success: boolean;
    message: string;
    externalId?: string;
    errors?: string[];
}

export interface ICRMConnector {
    syncContact(customerId: string): Promise<SyncResult>;
    syncLead(customerId: string, source?: string): Promise<SyncResult>;
    createOpportunity(params: {
        customerId: string;
        name: string;
        value?: number;
        stage?: string;
    }): Promise<SyncResult>;
    createCase(params: {
        customerId: string;
        subject: string;
        description: string;
        priority?: string;
    }): Promise<SyncResult>;
    getContact(externalId: string): Promise<any>;
}

/**
 * CRM Connector Base Service
 * Abstract base class for all CRM integrations
 */
export abstract class CRMConnectorService implements ICRMConnector {
    protected config: CRMConfig;

    constructor(config: CRMConfig) {
        this.config = config;
    }

    abstract syncContact(customerId: string): Promise<SyncResult>;
    abstract syncLead(customerId: string, source?: string): Promise<SyncResult>;
    abstract createOpportunity(params: {
        customerId: string;
        name: string;
        value?: number;
        stage?: string;
    }): Promise<SyncResult>;
    abstract createCase(params: {
        customerId: string;
        subject: string;
        description: string;
        priority?: string;
    }): Promise<SyncResult>;
    abstract getContact(externalId: string): Promise<any>;

    /**
     * Log sync activity
     */
    protected async logSync(
        entityType: string,
        customerId: string,
        externalId: string | undefined,
        success: boolean,
        error?: string
    ): Promise<void> {
        try {
            // Could create a separate CRM sync log table if needed
            logger.info(
                {
                    businessId: this.config.businessId,
                    provider: this.config.provider,
                    entityType,
                    customerId,
                    externalId,
                    success,
                    error,
                },
                `CRM sync ${success ? 'successful' : 'failed'}`
            );
        } catch (err) {
            logger.error({ err }, 'Failed to log CRM sync');
        }
    }
}

/**
 * Salesforce Integration Service
 */
export class SalesforceService extends CRMConnectorService {
    private baseUrl: string;
    private headers: Record<string, string>;

    constructor(config: CRMConfig) {
        super(config);
        this.baseUrl = config.instanceUrl || 'https://login.salesforce.com';
        this.headers = {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
        };
    }

    async syncContact(customerId: string): Promise<SyncResult> {
        try {
            const customer = await db.customer.findUnique({
                where: { id: customerId },
                include: { business: true },
            });

            if (!customer) {
                return { success: false, message: 'Customer not found' };
            }

            // Salesforce Contact API call
            const contactData = {
                FirstName: customer.name?.split(' ')[0] || 'Unknown',
                LastName: customer.name?.split(' ').slice(1).join(' ') || 'Customer',
                Email: customer.email,
                Phone: customer.phone,
                Description: `Synced from Omnichannel AI Platform\nBusiness: ${customer.business.name}`,
                LeadSource: 'AI Chat',
            };

            const response = await fetch(`${this.baseUrl}/services/data/v58.0/sobjects/Contact`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(contactData),
            });

            if (!response.ok) {
                const error = await response.text();
                await this.logSync('Contact', customerId, undefined, false, error);
                return { success: false, message: `Salesforce API error: ${error}` };
            }

            const result = await response.json();
            await this.logSync('Contact', customerId, result.id, true);

            // Log cost
            await CostTrackerService.logExternalCost({
                businessId: this.config.businessId,
                customerId,
                service: 'SALESFORCE_API',
                cost: 0.001, // Minimal cost for API call
                metadata: { action: 'sync_contact', externalId: result.id },
            });

            return {
                success: true,
                message: 'Contact synced successfully',
                externalId: result.id,
            };
        } catch (error) {
            logger.error({ error, customerId }, 'Salesforce sync contact failed');
            return { success: false, message: 'Internal error', errors: [String(error)] };
        }
    }

    async syncLead(customerId: string, source = 'AI Chat'): Promise<SyncResult> {
        try {
            const customer = await db.customer.findUnique({
                where: { id: customerId },
                include: { business: true },
            });

            if (!customer) {
                return { success: false, message: 'Customer not found' };
            }

            const leadData = {
                FirstName: customer.name?.split(' ')[0] || 'Unknown',
                LastName: customer.name?.split(' ').slice(1).join(' ') || 'Lead',
                Email: customer.email,
                Phone: customer.phone,
                Company: customer.business.name,
                LeadSource: source,
                Description: `Qualified lead from AI conversation\nTrust Score: ${customer.trustScore}`,
            };

            const response = await fetch(`${this.baseUrl}/services/data/v58.0/sobjects/Lead`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(leadData),
            });

            if (!response.ok) {
                const error = await response.text();
                return { success: false, message: `Salesforce API error: ${error}` };
            }

            const result = await response.json();

            await CostTrackerService.logExternalCost({
                businessId: this.config.businessId,
                customerId,
                service: 'SALESFORCE_API',
                cost: 0.001,
                metadata: { action: 'sync_lead', externalId: result.id },
            });

            return {
                success: true,
                message: 'Lead created successfully',
                externalId: result.id,
            };
        } catch (error) {
            logger.error({ error, customerId }, 'Salesforce sync lead failed');
            return { success: false, message: 'Internal error' };
        }
    }

    async createOpportunity(params: {
        customerId: string;
        name: string;
        value?: number;
        stage?: string;
    }): Promise<SyncResult> {
        try {
            const customer = await db.customer.findUnique({
                where: { id: params.customerId },
            });

            if (!customer) {
                return { success: false, message: 'Customer not found' };
            }

            // First sync contact to get external ID
            const contactResult = await this.syncContact(params.customerId);
            if (!contactResult.success || !contactResult.externalId) {
                return { success: false, message: 'Failed to sync contact first' };
            }

            const oppData = {
                Name: params.name,
                Amount: params.value || 0,
                StageName: params.stage || 'Prospecting',
                CloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                AccountId: contactResult.externalId,
            };

            const response = await fetch(
                `${this.baseUrl}/services/data/v58.0/sobjects/Opportunity`,
                {
                    method: 'POST',
                    headers: this.headers,
                    body: JSON.stringify(oppData),
                }
            );

            if (!response.ok) {
                const error = await response.text();
                return { success: false, message: `Salesforce API error: ${error}` };
            }

            const result = await response.json();

            await CostTrackerService.logExternalCost({
                businessId: this.config.businessId,
                customerId: params.customerId,
                service: 'SALESFORCE_API',
                cost: 0.001,
                metadata: { action: 'create_opportunity', externalId: result.id },
            });

            return {
                success: true,
                message: 'Opportunity created',
                externalId: result.id,
            };
        } catch (error) {
            logger.error({ error, params }, 'Salesforce create opportunity failed');
            return { success: false, message: 'Internal error' };
        }
    }

    async createCase(params: {
        customerId: string;
        subject: string;
        description: string;
        priority?: string;
    }): Promise<SyncResult> {
        try {
            const customer = await db.customer.findUnique({
                where: { id: params.customerId },
            });

            if (!customer) {
                return { success: false, message: 'Customer not found' };
            }

            const caseData = {
                Subject: params.subject,
                Description: params.description,
                Priority: params.priority || 'Medium',
                Origin: 'AI Chat',
                SuppliedEmail: customer.email,
                SuppliedPhone: customer.phone,
            };

            const response = await fetch(`${this.baseUrl}/services/data/v58.0/sobjects/Case`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(caseData),
            });

            if (!response.ok) {
                const error = await response.text();
                return { success: false, message: `Salesforce API error: ${error}` };
            }

            const result = await response.json();

            await CostTrackerService.logExternalCost({
                businessId: this.config.businessId,
                customerId: params.customerId,
                service: 'SALESFORCE_API',
                cost: 0.001,
                metadata: { action: 'create_case', externalId: result.id },
            });

            return {
                success: true,
                message: 'Case created',
                externalId: result.id,
            };
        } catch (error) {
            logger.error({ error, params }, 'Salesforce create case failed');
            return { success: false, message: 'Internal error' };
        }
    }

    async getContact(externalId: string): Promise<any> {
        try {
            const response = await fetch(
                `${this.baseUrl}/services/data/v58.0/sobjects/Contact/${externalId}`,
                {
                    headers: this.headers,
                }
            );

            if (!response.ok) {
                return null;
            }

            return await response.json();
        } catch (error) {
            logger.error({ error, externalId }, 'Salesforce get contact failed');
            return null;
        }
    }
}

/**
 * HubSpot Integration Service
 */
export class HubSpotService extends CRMConnectorService {
    private apiKey: string;
    private baseUrl = 'https://api.hubapi.com';

    constructor(config: CRMConfig) {
        super(config);
        this.apiKey = config.apiKey || '';
    }

    async syncContact(customerId: string): Promise<SyncResult> {
        try {
            const customer = await db.customer.findUnique({
                where: { id: customerId },
                include: { business: true },
            });

            if (!customer) {
                return { success: false, message: 'Customer not found' };
            }

            const contactData = {
                properties: {
                    email: customer.email,
                    firstname: customer.name?.split(' ')[0] || 'Unknown',
                    lastname: customer.name?.split(' ').slice(1).join(' ') || 'Customer',
                    phone: customer.phone,
                    company: customer.business.name,
                    source: 'Omnichannel AI Platform',
                    lifecyclestage: 'lead',
                },
            };

            const response = await fetch(
                `${this.baseUrl}/crm/v3/objects/contacts?hapikey=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(contactData),
                }
            );

            if (!response.ok) {
                const error = await response.text();
                return { success: false, message: `HubSpot API error: ${error}` };
            }

            const result = await response.json();

            await CostTrackerService.logExternalCost({
                businessId: this.config.businessId,
                customerId,
                service: 'HUBSPOT_API',
                cost: 0.001,
                metadata: { action: 'sync_contact', externalId: result.id },
            });

            return {
                success: true,
                message: 'Contact synced',
                externalId: result.id,
            };
        } catch (error) {
            logger.error({ error, customerId }, 'HubSpot sync contact failed');
            return { success: false, message: 'Internal error' };
        }
    }

    async syncLead(customerId: string, source = 'AI Chat'): Promise<SyncResult> {
        // HubSpot doesn't distinguish leads from contacts, treat as contact
        return this.syncContact(customerId);
    }

    async createOpportunity(params: {
        customerId: string;
        name: string;
        value?: number;
        stage?: string;
    }): Promise<SyncResult> {
        try {
            // First get or create contact
            const contactResult = await this.syncContact(params.customerId);
            if (!contactResult.success) {
                return contactResult;
            }

            const dealData = {
                properties: {
                    dealname: params.name,
                    amount: params.value?.toString() || '0',
                    dealstage: params.stage || 'appointmentscheduled',
                    pipeline: 'default',
                },
                associations: {
                    contacts: { results: [{ id: contactResult.externalId }] },
                },
            };

            const response = await fetch(
                `${this.baseUrl}/crm/v3/objects/deals?hapikey=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dealData),
                }
            );

            if (!response.ok) {
                const error = await response.text();
                return { success: false, message: `HubSpot API error: ${error}` };
            }

            const result = await response.json();

            await CostTrackerService.logExternalCost({
                businessId: this.config.businessId,
                customerId: params.customerId,
                service: 'HUBSPOT_API',
                cost: 0.001,
                metadata: { action: 'create_deal', externalId: result.id },
            });

            return {
                success: true,
                message: 'Deal created',
                externalId: result.id,
            };
        } catch (error) {
            logger.error({ error, params }, 'HubSpot create deal failed');
            return { success: false, message: 'Internal error' };
        }
    }

    async createCase(params: {
        customerId: string;
        subject: string;
        description: string;
        priority?: string;
    }): Promise<SyncResult> {
        try {
            const ticketData = {
                properties: {
                    subject: params.subject,
                    content: params.description,
                    priority: params.priority?.toUpperCase() || 'MEDIUM',
                    source_type: 'CHAT',
                },
            };

            const response = await fetch(
                `${this.baseUrl}/crm/v3/objects/tickets?hapikey=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(ticketData),
                }
            );

            if (!response.ok) {
                const error = await response.text();
                return { success: false, message: `HubSpot API error: ${error}` };
            }

            const result = await response.json();

            await CostTrackerService.logExternalCost({
                businessId: this.config.businessId,
                customerId: params.customerId,
                service: 'HUBSPOT_API',
                cost: 0.001,
                metadata: { action: 'create_ticket', externalId: result.id },
            });

            return {
                success: true,
                message: 'Ticket created',
                externalId: result.id,
            };
        } catch (error) {
            logger.error({ error, params }, 'HubSpot create ticket failed');
            return { success: false, message: 'Internal error' };
        }
    }

    async getContact(externalId: string): Promise<any> {
        try {
            const response = await fetch(
                `${this.baseUrl}/crm/v3/objects/contacts/${externalId}?hapikey=${this.apiKey}`,
                {
                    headers: { 'Content-Type': 'application/json' },
                }
            );

            if (!response.ok) {
                return null;
            }

            return await response.json();
        } catch (error) {
            logger.error({ error, externalId }, 'HubSpot get contact failed');
            return null;
        }
    }
}

/**
 * Zoho CRM Integration Service
 */
export class ZohoService extends CRMConnectorService {
    private accessToken: string;
    private baseUrl: string;

    constructor(config: CRMConfig) {
        super(config);
        this.accessToken = config.accessToken || '';
        this.baseUrl = config.instanceUrl || 'https://www.zohoapis.com';
    }

    async syncContact(customerId: string): Promise<SyncResult> {
        try {
            const customer = await db.customer.findUnique({
                where: { id: customerId },
                include: { business: true },
            });

            if (!customer) {
                return { success: false, message: 'Customer not found' };
            }

            const contactData = {
                data: [
                    {
                        First_Name: customer.name?.split(' ')[0] || 'Unknown',
                        Last_Name: customer.name?.split(' ').slice(1).join(' ') || 'Customer',
                        Email: customer.email,
                        Phone: customer.phone,
                        Account_Name: customer.business.name,
                        Lead_Source: 'AI Chat',
                    },
                ],
            };

            const response = await fetch(`${this.baseUrl}/crm/v2/Contacts`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(contactData),
            });

            if (!response.ok) {
                const error = await response.text();
                return { success: false, message: `Zoho API error: ${error}` };
            }

            const result = await response.json();
            const contactId = result.data?.[0]?.details?.id;

            await CostTrackerService.logExternalCost({
                businessId: this.config.businessId,
                customerId,
                service: 'ZOHO_API',
                cost: 0.001,
                metadata: { action: 'sync_contact', externalId: contactId },
            });

            return {
                success: true,
                message: 'Contact synced',
                externalId: contactId,
            };
        } catch (error) {
            logger.error({ error, customerId }, 'Zoho sync contact failed');
            return { success: false, message: 'Internal error' };
        }
    }

    async syncLead(customerId: string, source = 'AI Chat'): Promise<SyncResult> {
        try {
            const customer = await db.customer.findUnique({
                where: { id: customerId },
                include: { business: true },
            });

            if (!customer) {
                return { success: false, message: 'Customer not found' };
            }

            const leadData = {
                data: [
                    {
                        First_Name: customer.name?.split(' ')[0] || 'Unknown',
                        Last_Name: customer.name?.split(' ').slice(1).join(' ') || 'Lead',
                        Email: customer.email,
                        Phone: customer.phone,
                        Company: customer.business.name,
                        Lead_Source: source,
                    },
                ],
            };

            const response = await fetch(`${this.baseUrl}/crm/v2/Leads`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(leadData),
            });

            if (!response.ok) {
                const error = await response.text();
                return { success: false, message: `Zoho API error: ${error}` };
            }

            const result = await response.json();
            const leadId = result.data?.[0]?.details?.id;

            await CostTrackerService.logExternalCost({
                businessId: this.config.businessId,
                customerId,
                service: 'ZOHO_API',
                cost: 0.001,
                metadata: { action: 'sync_lead', externalId: leadId },
            });

            return {
                success: true,
                message: 'Lead created',
                externalId: leadId,
            };
        } catch (error) {
            logger.error({ error, customerId }, 'Zoho sync lead failed');
            return { success: false, message: 'Internal error' };
        }
    }

    async createOpportunity(params: {
        customerId: string;
        name: string;
        value?: number;
        stage?: string;
    }): Promise<SyncResult> {
        try {
            const oppData = {
                data: [
                    {
                        Deal_Name: params.name,
                        Amount: params.value || 0,
                        Stage: params.stage || 'Qualification',
                    },
                ],
            };

            const response = await fetch(`${this.baseUrl}/crm/v2/Deals`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(oppData),
            });

            if (!response.ok) {
                const error = await response.text();
                return { success: false, message: `Zoho API error: ${error}` };
            }

            const result = await response.json();
            const dealId = result.data?.[0]?.details?.id;

            await CostTrackerService.logExternalCost({
                businessId: this.config.businessId,
                customerId: params.customerId,
                service: 'ZOHO_API',
                cost: 0.001,
                metadata: { action: 'create_deal', externalId: dealId },
            });

            return {
                success: true,
                message: 'Deal created',
                externalId: dealId,
            };
        } catch (error) {
            logger.error({ error, params }, 'Zoho create deal failed');
            return { success: false, message: 'Internal error' };
        }
    }

    async createCase(params: {
        customerId: string;
        subject: string;
        description: string;
        priority?: string;
    }): Promise<SyncResult> {
        try {
            const caseData = {
                data: [
                    {
                        Subject: params.subject,
                        Description: params.description,
                        Priority: params.priority || 'Medium',
                        Status: 'Open',
                    },
                ],
            };

            const response = await fetch(`${this.baseUrl}/crm/v2/Cases`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(caseData),
            });

            if (!response.ok) {
                const error = await response.text();
                return { success: false, message: `Zoho API error: ${error}` };
            }

            const result = await response.json();
            const caseId = result.data?.[0]?.details?.id;

            await CostTrackerService.logExternalCost({
                businessId: this.config.businessId,
                customerId: params.customerId,
                service: 'ZOHO_API',
                cost: 0.001,
                metadata: { action: 'create_case', externalId: caseId },
            });

            return {
                success: true,
                message: 'Case created',
                externalId: caseId,
            };
        } catch (error) {
            logger.error({ error, params }, 'Zoho create case failed');
            return { success: false, message: 'Internal error' };
        }
    }

    async getContact(externalId: string): Promise<any> {
        try {
            const response = await fetch(
                `${this.baseUrl}/crm/v2/Contacts/${externalId}`,
                {
                    headers: {
                        Authorization: `Bearer ${this.accessToken}`,
                    },
                }
            );

            if (!response.ok) {
                return null;
            }

            return await response.json();
        } catch (error) {
            logger.error({ error, externalId }, 'Zoho get contact failed');
            return null;
        }
    }
}

/**
 * CRM Factory - Get appropriate CRM connector
 */
export class CRMFactory {
    static getConnector(config: CRMConfig): ICRMConnector {
        switch (config.provider) {
            case 'SALESFORCE':
                return new SalesforceService(config);
            case 'HUBSPOT':
                return new HubSpotService(config);
            case 'ZOHO':
                return new ZohoService(config);
            default:
                throw new Error(`Unsupported CRM provider: ${config.provider}`);
        }
    }

    /**
     * Get CRM configuration for business
     */
    static async getConfig(businessId: string): Promise<CRMConfig | null> {
        const config = await db.cRMIntegration.findFirst({
            where: {
                businessId,
                enabled: true,
            },
        });

        if (!config) {
            return null;
        }

        return {
            id: config.id,
            businessId: config.businessId,
            provider: config.provider as any,
            enabled: config.enabled,
            apiKey: config.apiKey || undefined,
            apiSecret: config.apiSecret || undefined,
            accessToken: config.accessToken || undefined,
            refreshToken: config.refreshToken || undefined,
            instanceUrl: config.instanceUrl || undefined,
            settings: (config.settings as Record<string, any>) || {},
            createdAt: config.createdAt,
            updatedAt: config.updatedAt,
        };
    }
}

/**
 * Outbound Webhook Service
 * Send events to external systems
 */
export class WebhookOutService {
    /**
     * Send webhook to external URL
     */
    static async send(params: {
        url: string;
        event: string;
        payload: Record<string, any>;
        headers?: Record<string, string>;
        secret?: string;
        retryCount?: number;
    }): Promise<{ success: boolean; statusCode?: number; error?: string }> {
        const maxRetries = params.retryCount || 3;
        let lastError: string | undefined;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // Generate signature if secret provided
                let headers = { ...params.headers, 'Content-Type': 'application/json' };
                if (params.secret) {
                    const signature = await this.generateSignature(params.payload, params.secret);
                    headers['X-Webhook-Signature'] = signature;
                }

                const response = await fetch(params.url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        event: params.event,
                        timestamp: new Date().toISOString(),
                        data: params.payload,
                    }),
                });

                if (response.ok) {
                    return { success: true, statusCode: response.status };
                } else {
                    lastError = `HTTP ${response.status}: ${await response.text()}`;
                }
            } catch (error) {
                lastError = String(error);
                // Exponential backoff
                if (attempt < maxRetries - 1) {
                    await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                }
            }
        }

        logger.error(
            { error: lastError, url: params.url, event: params.event },
            'Webhook delivery failed after retries'
        );

        return { success: false, error: lastError };
    }

    /**
     * Send customer event
     */
    static async sendCustomerEvent(
        businessId: string,
        customerId: string,
        event: string,
        data: Record<string, any>
    ): Promise<void> {
        const configs = await db.cRMIntegration.findMany({
            where: {
                businessId,
                enabled: true,
                provider: 'CUSTOM',
            },
        });

        for (const config of configs) {
            const settings = (config.settings as any) || {};
            if (settings.webhookUrl) {
                await this.send({
                    url: settings.webhookUrl,
                    event,
                    payload: {
                        businessId,
                        customerId,
                        ...data,
                    },
                    secret: config.apiSecret || undefined,
                });
            }
        }
    }

    /**
     * Generate HMAC signature for webhook
     */
    private static async generateSignature(payload: any, secret: string): Promise<string> {
        const { createHmac } = await import('crypto');
        const hmac = createHmac('sha256', secret);
        hmac.update(JSON.stringify(payload));
        return `sha256=${hmac.digest('hex')}`;
    }
}
