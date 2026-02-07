import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { logger } from '@/utils/logger';

/**
 * Encryption Service
 * 
 * Provides field-level encryption for PII (Personally Identifiable Information).
 * Uses AES-256-GCM for authenticated encryption.
 * 
 * CRITICAL: Set ENCRYPTION_KEY environment variable (64 hex chars = 32 bytes)
 * Generate with: openssl rand -hex 32
 */
export class EncryptionService {
  private static algorithm = 'aes-256-gcm' as const;
  private static saltLength = 64;
  private static ivLength = 16;
  private static tagLength = 16;
  private static keyLength = 32; // 256 bits

  private static key: Buffer | null = null;

  /**
   * Initialize encryption key from environment variable
   */
  private static getKey(): Buffer {
    if (this.key) return this.key;

    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex) {
      throw new Error(
        'ENCRYPTION_KEY environment variable not set! ' +
        'Generate with: openssl rand -hex 32'
      );
    }

    if (keyHex.length !== 64) {
      throw new Error(
        `ENCRYPTION_KEY must be 64 hex characters (32 bytes), got ${keyHex.length}`
      );
    }

    this.key = Buffer.from(keyHex, 'hex');
    return this.key;
  }

  /**
   * Encrypt a string
   * 
   * @param plaintext - String to encrypt
   * @returns Encrypted string in format: iv:authTag:salt:encrypted
   */
  static encrypt(plaintext: string): string {
    if (!plaintext) return plaintext; // Don't encrypt null/empty strings

    try {
      const key = this.getKey();

      // Generate random IV and salt
      const iv = randomBytes(this.ivLength);
      const salt = randomBytes(this.saltLength);

      // Derive key with salt for additional security
      const derivedKey = scryptSync(key, salt, this.keyLength);

      // Create cipher
      const cipher = createCipheriv(this.algorithm, derivedKey, iv);

      // Encrypt
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Get authentication tag
      const authTag = cipher.getAuthTag();

      // Format: iv:authTag:salt:encrypted
      return [
        iv.toString('hex'),
        authTag.toString('hex'),
        salt.toString('hex'),
        encrypted,
      ].join(':');
    } catch (error) {
      logger.error({ error }, 'Encryption failed');
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt a string
   * 
   * @param encrypted - Encrypted string from encrypt()
   * @returns Decrypted plaintext
   */
  static decrypt(encrypted: string): string {
    if (!encrypted) return encrypted; // Don't decrypt null/empty strings

    try {
      const key = this.getKey();

      // Parse encrypted format
      const parts = encrypted.split(':');
      if (parts.length !== 4) {
        throw new Error('Invalid encrypted format');
      }

      const [ivHex, authTagHex, saltHex, data] = parts;

      // Convert from hex
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const salt = Buffer.from(saltHex, 'hex');

      // Derive same key with salt
      const derivedKey = scryptSync(key, salt, this.keyLength);

      // Create decipher
      const decipher = createDecipheriv(this.algorithm, derivedKey, iv);
      decipher.setAuthTag(authTag);

      // Decrypt
      let decrypted = decipher.update(data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logger.error({ error }, 'Decryption failed');
      throw new Error('Decryption failed');
    }
  }

  /**
   * Hash a value (one-way, for API keys)
   * 
   * @param value - Value to hash
   * @returns Hex string hash
   */
  static hash(value: string): string {
    const { createHash } = require('crypto');
    return createHash('sha256').update(value).digest('hex');
  }

  /**
   * Encrypt multiple fields in an object
   */
  static encryptFields<T extends Record<string, any>>(
    obj: T,
    fields: Array<keyof T>
  ): T {
    const result = { ...obj };

    for (const field of fields) {
      if (result[field] && typeof result[field] === 'string') {
        result[field] = this.encrypt(result[field] as string) as any;
      }
    }

    return result;
  }

  /**
   * Decrypt multiple fields in an object
   */
  static decryptFields<T extends Record<string, any>>(
    obj: T,
    fields: Array<keyof T>
  ): T {
    const result = { ...obj };

    for (const field of fields) {
      if (result[field] && typeof result[field] === 'string') {
        try {
          result[field] = this.decrypt(result[field] as string) as any;
        } catch {
          // If decryption fails, field might not be encrypted (backwards compatibility)
          logger.warn({ field }, 'Field decryption failed - might be unencrypted');
        }
      }
    }

    return result;
  }

  /**
   * Check if encryption is properly configured
   */
  static isConfigured(): boolean {
    try {
      this.getKey();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate encryption key on startup
   */
  static validateSetup(): void {
    if (!this.isConfigured()) {
      throw new Error(
        'Encryption not configured! Set ENCRYPTION_KEY environment variable.\n' +
        'Generate with: openssl rand -hex 32'
      );
    }

    // Test encryption/decryption
    const testData = 'test-123-åäö-🔒';
    const encrypted = this.encrypt(testData);
    const decrypted = this.decrypt(encrypted);

    if (decrypted !== testData) {
      throw new Error('Encryption test failed!');
    }

    logger.info('Encryption service validated successfully');
  }
}
