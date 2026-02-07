/**
 * Utility functions for embedding operations
 */

/**
 * Calculate cosine similarity between two embedding vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    
    // Handle floating point errors
    return Math.max(-1, Math.min(1, similarity));
}

/**
 * Hash a vector for cache key generation
 */
export function hashVector(vector: number[]): string {
    // Simple hash: use first 10 values + length
    const sample = vector.slice(0, 10).map(v => Math.round(v * 1000));
    return `${vector.length}-${sample.join(',')}`;
}

/**
 * Normalize a query string for consistent matching
 */
export function normalizeQuery(query: string): string {
    return query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 500);
}

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

/**
 * Calculate string similarity (0-1 scale)
 */
export function calculateStringSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
}

/**
 * Detect if text is gibberish/spam
 */
export function isGibberish(text: string): boolean {
    if (text.length < 10) return false;

    // Check non-alphanumeric ratio
    const nonAlphaNum = text.replace(/[a-zA-Z0-9\s]/g, '').length;
    const ratio = nonAlphaNum / text.length;

    // Check for excessive repetition
    const repeatedChars = /(.+)\1{4,}/.test(text);

    // Check for keyboard mashing
    const randomPattern = /[asdfjkl;qwertyuiopzxcvbnm]{10,}/i.test(text);

    return ratio > 0.7 || repeatedChars || randomPattern;
}

/**
 * Format cost for display (e.g., $0.001)
 */
export function formatCost(cost: number): string {
    if (cost < 0.01) {
        return `$${cost.toFixed(4)}`;
    }
    return `$${cost.toFixed(2)}`;
}

/**
 * Format large numbers (e.g., 1.2K, 1.5M)
 */
export function formatNumber(num: number): string {
    if (num >= 1000000) {
        return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
): Promise<T> {
    let lastError: Error;

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;
            
            if (i < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, i);
                await sleep(delay);
            }
        }
    }

    throw lastError!;
}

/**
 * Safely parse JSON with fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
    try {
        return JSON.parse(json) as T;
    } catch {
        return fallback;
    }
}

/**
 * Truncate text to specified length
 */
export function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

/**
 * Mask sensitive data (phone, email)
 */
export function maskSensitiveData(value: string, type: 'phone' | 'email'): string {
    if (type === 'phone') {
        // Show last 4 digits
        return value.replace(/.(?=.{4})/g, '*');
    }
    
    if (type === 'email') {
        // Show first 2 and domain
        const [local, domain] = value.split('@');
        return `${local.substring(0, 2)}***@${domain}`;
    }
    
    return value;
}
