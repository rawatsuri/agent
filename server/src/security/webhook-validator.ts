import crypto from 'crypto';
import { logger } from '@/utils/logger';

/**
 * Webhook Validator Service
 *
 * Validates webhook signatures from external services:
 * - Meta (WhatsApp, Instagram)
 * - SendGrid
 * - Exotel
 * - Telegram
 */
export class WebhookValidator {
  /**
   * Validate Meta webhook signature (WhatsApp, Instagram)
   */
  static validateMetaSignature(
    body: string,
    signature: string,
    appSecret: string
  ): boolean {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', appSecret)
        .update(body)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      logger.error({ error }, 'Meta signature validation failed');
      return false;
    }
  }

  /**
   * Validate SendGrid webhook signature
   */
  static validateSendGridSignature(
    body: string,
    signature: string,
    publicKey: string
  ): boolean {
    try {
      // SendGrid uses RSA-SHA256
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(body);
      return verifier.verify(publicKey, signature, 'base64');
    } catch (error) {
      logger.error({ error }, 'SendGrid signature validation failed');
      return false;
    }
  }

  /**
   * Validate Exotel webhook (uses basic auth + IP whitelist)
   */
  static validateExotelWebhook(
    authHeader: string,
    expectedAuth: string
  ): boolean {
    return authHeader === expectedAuth;
  }

  /**
   * Validate Telegram webhook (uses bot token in URL)
   */
  static validateTelegramWebhook(
    token: string,
    expectedToken: string
  ): boolean {
    return token === expectedToken;
  }

  /**
   * Generate Meta webhook challenge response
   */
  static generateMetaChallengeResponse(
    challenge: string,
    verifyToken: string
  ): string | null {
    if (challenge && verifyToken) {
      return challenge;
    }
    return null;
  }

  /**
   * Verify Meta webhook challenge
   */
  static verifyMetaChallenge(
    mode: string,
    token: string,
    expectedToken: string
  ): boolean {
    return mode === 'subscribe' && token === expectedToken;
  }
}
