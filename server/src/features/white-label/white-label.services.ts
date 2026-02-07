/**
 * White-label Customization Services
 * 
 * 1. Branding Service - Manage custom branding
 * 2. Domain Service - Custom domain management
 */

import { db } from '@/config/database';
import { logger } from '@/utils/logger';
import { storage } from '@/config/storage'; // Assume S3/local storage config exists

export interface BrandingConfig {
    id: string;
    businessId: string;
    colors: {
        primary: string;
        secondary: string;
        accent: string;
        background: string;
        text: string;
    };
    logo: {
        url: string;
        darkModeUrl?: string;
        favicon?: string;
    };
    typography: {
        headingFont: string;
        bodyFont: string;
    };
    customCSS?: string;
    emailTemplates: {
        headerHTML: string;
        footerHTML: string;
        signature: string;
    };
    chatWidget: {
        position: 'bottom-left' | 'bottom-right';
        greeting: string;
        placeholder: string;
        showBranding: boolean;
    };
}

export interface CustomDomain {
    id: string;
    businessId: string;
    domain: string;
    status: 'PENDING' | 'VERIFIED' | 'FAILED';
    verificationMethod: 'DNS' | 'FILE';
    verificationToken: string;
    sslStatus: 'PENDING' | 'ACTIVE' | 'FAILED';
    sslCertificate?: string;
    sslExpiresAt?: Date;
    createdAt: Date;
    verifiedAt?: Date;
}

/**
 * Branding Service
 * Manage white-label branding for businesses
 */
export class BrandingService {
    /**
     * Default branding configuration
     */
    static readonly DEFAULT_BRANDING = {
        colors: {
            primary: '#3B82F6',
            secondary: '#6366F1',
            accent: '#10B981',
            background: '#FFFFFF',
            text: '#1F2937',
        },
        typography: {
            headingFont: 'Inter',
            bodyFont: 'Inter',
        },
        chatWidget: {
            position: 'bottom-right' as const,
            greeting: 'Hi! How can I help you today?',
            placeholder: 'Type your message...',
            showBranding: true,
        },
    };

    /**
     * Get branding configuration for business
     */
    static async getBranding(businessId: string): Promise<BrandingConfig> {
        const branding = await db.customBranding.findUnique({
            where: { businessId },
        });

        if (!branding) {
            return this.createDefaultBranding(businessId);
        }

        return {
            id: branding.id,
            businessId: branding.businessId,
            colors: (branding.colors as any) || this.DEFAULT_BRANDING.colors,
            logo: (branding.logo as any) || { url: '' },
            typography: (branding.typography as any) || this.DEFAULT_BRANDING.typography,
            customCSS: branding.customCSS || undefined,
            emailTemplates: (branding.emailTemplates as any) || {
                headerHTML: '',
                footerHTML: '',
                signature: '',
            },
            chatWidget: (branding.chatWidget as any) || this.DEFAULT_BRANDING.chatWidget,
        };
    }

    /**
     * Create default branding for new business
     */
    static async createDefaultBranding(businessId: string): Promise<BrandingConfig> {
        const branding = await db.customBranding.create({
            data: {
                businessId,
                colors: this.DEFAULT_BRANDING.colors,
                typography: this.DEFAULT_BRANDING.typography,
                chatWidget: this.DEFAULT_BRANDING.chatWidget,
                emailTemplates: {
                    headerHTML: '',
                    footerHTML: '',
                    signature: '',
                },
            },
        });

        return {
            id: branding.id,
            businessId: branding.businessId,
            colors: branding.colors as any,
            logo: branding.logo as any,
            typography: branding.typography as any,
            customCSS: branding.customCSS || undefined,
            emailTemplates: branding.emailTemplates as any,
            chatWidget: branding.chatWidget as any,
        };
    }

    /**
     * Update branding colors
     */
    static async updateColors(
        businessId: string,
        colors: Partial<BrandingConfig['colors']>
    ): Promise<BrandingConfig> {
        const existing = await this.getBranding(businessId);

        const updated = await db.customBranding.update({
            where: { businessId },
            data: {
                colors: {
                    ...existing.colors,
                    ...colors,
                },
            },
        });

        logger.info({ businessId, colors }, 'Branding colors updated');

        return this.getBranding(businessId);
    }

    /**
     * Upload logo
     */
    static async uploadLogo(
        businessId: string,
        file: Buffer,
        filename: string,
        type: 'light' | 'dark' = 'light'
    ): Promise<{ url: string }> {
        try {
            // Upload to storage (S3 or local)
            const key = `branding/${businessId}/logo-${type}-${Date.now()}-${filename}`;
            // const url = await storage.upload(key, file, 'image/png');
            const url = `https://cdn.example.com/${key}`; // Placeholder

            const existing = await db.customBranding.findUnique({
                where: { businessId },
            });

            const logoData = existing?.logo as any || {};

            await db.customBranding.update({
                where: { businessId },
                data: {
                    logo: {
                        ...logoData,
                        [type === 'light' ? 'url' : 'darkModeUrl']: url,
                    },
                },
            });

            logger.info({ businessId, type, url }, 'Logo uploaded');

            return { url };
        } catch (error) {
            logger.error({ error, businessId }, 'Failed to upload logo');
            throw new Error('Failed to upload logo');
        }
    }

    /**
     * Update custom CSS
     */
    static async updateCustomCSS(
        businessId: string,
        css: string
    ): Promise<BrandingConfig> {
        // Validate CSS (basic sanitization)
        const sanitizedCSS = this.sanitizeCSS(css);

        await db.customBranding.update({
            where: { businessId },
            data: { customCSS: sanitizedCSS },
        });

        logger.info({ businessId }, 'Custom CSS updated');

        return this.getBranding(businessId);
    }

    /**
     * Sanitize CSS to prevent XSS
     */
    private static sanitizeCSS(css: string): string {
        // Remove potentially dangerous CSS
        const dangerous = [
            /expression\s*\(/gi,
            /javascript\s*:/gi,
            /behavior\s*:/gi,
            /@import/gi,
        ];

        let sanitized = css;
        for (const pattern of dangerous) {
            sanitized = sanitized.replace(pattern, '');
        }

        return sanitized;
    }

    /**
     * Update email templates
     */
    static async updateEmailTemplates(
        businessId: string,
        templates: Partial<BrandingConfig['emailTemplates']>
    ): Promise<BrandingConfig> {
        const existing = await this.getBranding(businessId);

        await db.customBranding.update({
            where: { businessId },
            data: {
                emailTemplates: {
                    ...existing.emailTemplates,
                    ...templates,
                },
            },
        });

        return this.getBranding(businessId);
    }

    /**
     * Update chat widget settings
     */
    static async updateChatWidget(
        businessId: string,
        settings: Partial<BrandingConfig['chatWidget']>
    ): Promise<BrandingConfig> {
        const existing = await this.getBranding(businessId);

        await db.customBranding.update({
            where: { businessId },
            data: {
                chatWidget: {
                    ...existing.chatWidget,
                    ...settings,
                },
            },
        });

        return this.getBranding(businessId);
    }

    /**
     * Generate CSS variables for branding
     */
    static generateCSSVariables(branding: BrandingConfig): string {
        return `
:root {
  --brand-primary: ${branding.colors.primary};
  --brand-secondary: ${branding.colors.secondary};
  --brand-accent: ${branding.colors.accent};
  --brand-background: ${branding.colors.background};
  --brand-text: ${branding.colors.text};
  --brand-heading-font: ${branding.typography.headingFont};
  --brand-body-font: ${branding.typography.bodyFont};
}
${branding.customCSS || ''}
    `.trim();
    }

    /**
     * Get chat widget embed code
     */
    static async getChatWidgetCode(businessId: string): Promise<string> {
        const branding = await this.getBranding(businessId);
        const business = await db.business.findUnique({
            where: { id: businessId },
        });

        if (!business) {
            throw new Error('Business not found');
        }

        return `
<!-- Omnichannel AI Chat Widget -->
<script>
(function() {
  var script = document.createElement('script');
  script.src = 'https://cdn.example.com/widget.js';
  script.async = true;
  script.dataset.businessId = '${businessId}';
  script.dataset.apiKey = '${business.apiKey}';
  script.dataset.position = '${branding.chatWidget.position}';
  script.dataset.greeting = '${branding.chatWidget.greeting}';
  document.head.appendChild(script);
})();
</script>
    `.trim();
    }
}

/**
 * Domain Service
 * Manage custom domains for white-label
 */
export class DomainService {
    /**
     * Add custom domain
     */
    static async addDomain(
        businessId: string,
        domain: string
    ): Promise<CustomDomain> {
        // Validate domain format
        if (!this.isValidDomain(domain)) {
            throw new Error('Invalid domain format');
        }

        // Check if domain already exists
        const existing = await db.customDomain.findFirst({
            where: { domain },
        });

        if (existing) {
            throw new Error('Domain already in use');
        }

        // Generate verification token
        const verificationToken = this.generateVerificationToken();

        const customDomain = await db.customDomain.create({
            data: {
                businessId,
                domain: domain.toLowerCase(),
                status: 'PENDING',
                verificationMethod: 'DNS',
                verificationToken,
                sslStatus: 'PENDING',
            },
        });

        logger.info({ businessId, domain }, 'Custom domain added');

        return {
            id: customDomain.id,
            businessId: customDomain.businessId,
            domain: customDomain.domain,
            status: customDomain.status as any,
            verificationMethod: customDomain.verificationMethod as any,
            verificationToken: customDomain.verificationToken,
            sslStatus: customDomain.sslStatus as any,
            createdAt: customDomain.createdAt,
        };
    }

    /**
     * Verify domain ownership
     */
    static async verifyDomain(domainId: string): Promise<{
        verified: boolean;
        message: string;
    }> {
        const customDomain = await db.customDomain.findUnique({
            where: { id: domainId },
        });

        if (!customDomain) {
            throw new Error('Domain not found');
        }

        try {
            // Check DNS TXT record for verification
            const { promises: dns } = await import('dns');
            const records = await dns.resolveTxt(customDomain.domain);

            const expectedRecord = `omnichannel-verification=${customDomain.verificationToken}`;
            const isVerified = records.some((record) =>
                record.includes(expectedRecord)
            );

            if (isVerified) {
                await db.customDomain.update({
                    where: { id: domainId },
                    data: {
                        status: 'VERIFIED',
                        verifiedAt: new Date(),
                    },
                });

                // Trigger SSL provisioning
                await this.provisionSSL(domainId);

                logger.info({ domainId, domain: customDomain.domain }, 'Domain verified');

                return { verified: true, message: 'Domain verified successfully' };
            } else {
                return {
                    verified: false,
                    message: 'Verification record not found. Please add the TXT record to your DNS.',
                };
            }
        } catch (error) {
            logger.error({ error, domainId }, 'Domain verification failed');
            return {
                verified: false,
                message: 'Failed to verify domain. Please check DNS settings.',
            };
        }
    }

    /**
     * Get domain verification instructions
     */
    static async getVerificationInstructions(domainId: string): Promise<{
        method: string;
        instructions: string[];
        record?: {
            type: string;
            name: string;
            value: string;
        };
    }> {
        const customDomain = await db.customDomain.findUnique({
            where: { id: domainId },
        });

        if (!customDomain) {
            throw new Error('Domain not found');
        }

        if (customDomain.verificationMethod === 'DNS') {
            return {
                method: 'DNS',
                instructions: [
                    'Add the following TXT record to your DNS settings:',
                    `Type: TXT`,
                    `Name: @`,
                    `Value: omnichannel-verification=${customDomain.verificationToken}`,
                    '',
                    'DNS changes may take 24-48 hours to propagate.',
                ],
                record: {
                    type: 'TXT',
                    name: '@',
                    value: `omnichannel-verification=${customDomain.verificationToken}`,
                },
            };
        } else {
            return {
                method: 'FILE',
                instructions: [
                    'Upload a file to your domain root:',
                    `File: omnichannel-verify.txt`,
                    `Content: ${customDomain.verificationToken}`,
                    '',
                    'Ensure the file is accessible at:',
                    `https://${customDomain.domain}/omnichannel-verify.txt`,
                ],
            };
        }
    }

    /**
     * Provision SSL certificate
     */
    static async provisionSSL(domainId: string): Promise<void> {
        const customDomain = await db.customDomain.findUnique({
            where: { id: domainId },
        });

        if (!customDomain || customDomain.status !== 'VERIFIED') {
            throw new Error('Domain must be verified before SSL provisioning');
        }

        try {
            // In production, integrate with Let's Encrypt or AWS ACM
            // For now, simulate SSL provisioning

            await db.customDomain.update({
                where: { id: domainId },
                data: {
                    sslStatus: 'ACTIVE',
                    sslExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
                },
            });

            logger.info({ domainId, domain: customDomain.domain }, 'SSL certificate provisioned');
        } catch (error) {
            logger.error({ error, domainId }, 'SSL provisioning failed');

            await db.customDomain.update({
                where: { id: domainId },
                data: { sslStatus: 'FAILED' },
            });
        }
    }

    /**
     * Remove custom domain
     */
    static async removeDomain(domainId: string): Promise<void> {
        const customDomain = await db.customDomain.findUnique({
            where: { id: domainId },
        });

        if (!customDomain) {
            throw new Error('Domain not found');
        }

        await db.customDomain.delete({
            where: { id: domainId },
        });

        logger.info({ domainId, domain: customDomain.domain }, 'Custom domain removed');
    }

    /**
     * Get all domains for business
     */
    static async getBusinessDomains(businessId: string): Promise<CustomDomain[]> {
        const domains = await db.customDomain.findMany({
            where: { businessId },
            orderBy: { createdAt: 'desc' },
        });

        return domains.map((d) => ({
            id: d.id,
            businessId: d.businessId,
            domain: d.domain,
            status: d.status as any,
            verificationMethod: d.verificationMethod as any,
            verificationToken: d.verificationToken,
            sslStatus: d.sslStatus as any,
            sslCertificate: d.sslCertificate || undefined,
            sslExpiresAt: d.sslExpiresAt || undefined,
            createdAt: d.createdAt,
            verifiedAt: d.verifiedAt || undefined,
        }));
    }

    /**
     * Validate domain format
     */
    private static isValidDomain(domain: string): boolean {
        const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
        return domainRegex.test(domain) && domain.includes('.');
    }

    /**
     * Generate verification token
     */
    private static generateVerificationToken(): string {
        return `verify_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    }
}
