import { logger } from '@/utils/logger';

/**
 * Email Parser - Handles email thread detection and parsing
 * 
 * Features:
 * - Thread detection via Message-ID, In-Reply-To, References headers
 * - Plain text extraction from HTML
 * - Signature detection and removal
 * - Quoted reply detection and handling
 */
export class EmailParser {
  /**
   * Extract clean message content from email
   * Removes signatures, quoted replies, and formatting
   */
  static extractCleanContent(emailContent: string, format: 'text' | 'html' = 'text'): string {
    let content = emailContent;

    if (format === 'html') {
      content = this.htmlToText(content);
    }

    // Remove quoted replies (lines starting with >)
    content = this.removeQuotedReplies(content);

    // Remove common signature patterns
    content = this.removeSignature(content);

    // Clean up extra whitespace
    content = content.replace(/\n{3,}/g, '\n\n').trim();

    return content;
  }

  /**
   * Detect if this email is part of an existing thread
   */
  static detectThread(
    headers: Record<string, string>,
    existingThreads: Array<{ messageIds: string[] }>
  ): { isThread: boolean; threadId?: string } {
    const inReplyTo = headers['In-Reply-To'] || headers['in-reply-to'];
    const references = headers['References'] || headers['references'];
    const messageId = headers['Message-Id'] || headers['message-id'];

    // Parse references (space-separated message IDs)
    const allRefs = [
      inReplyTo,
      ...(references ? references.split(/\s+/) : []),
    ].filter(Boolean);

    // Check if any reference matches existing threads
    for (const thread of existingThreads) {
      for (const ref of allRefs) {
        if (thread.messageIds.includes(ref)) {
          return { isThread: true, threadId: thread.messageIds[0] };
        }
      }
    }

    // New thread - use current message ID
    return { isThread: false, threadId: messageId };
  }

  /**
   * Extract thread information from email headers
   */
  static extractThreadInfo(headers: Record<string, string>): {
    messageId: string;
    inReplyTo?: string;
    references: string[];
    subject: string;
    threadSubject: string;
  } {
    const subject = headers['Subject'] || '';
    
    // Remove Re:, Fwd:, etc. to get base subject
    const threadSubject = subject
      .replace(/^(Re|RE|Fw|FW|FWD|Fwd):\s*/gi, '')
      .trim();

    return {
      messageId: headers['Message-Id'] || headers['message-id'] || '',
      inReplyTo: headers['In-Reply-To'] || headers['in-reply-to'],
      references: (headers['References'] || headers['references'] || '')
        .split(/\s+/)
        .filter(Boolean),
      subject,
      threadSubject,
    };
  }

  /**
   * Convert HTML to plain text
   */
  private static htmlToText(html: string): string {
    // Remove script and style tags
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Replace block elements with newlines
    text = text
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li>/gi, '\n- ');

    // Remove all HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Clean up whitespace
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    return text;
  }

  /**
   * Remove quoted reply sections
   */
  private static removeQuotedReplies(content: string): string {
    const lines = content.split('\n');
    const cleanLines: string[] = [];
    let inQuote = false;

    for (const line of lines) {
      // Check if line is a quote
      if (line.startsWith('>') || /^On .* wrote:/.test(line)) {
        inQuote = true;
      }

      if (!inQuote) {
        cleanLines.push(line);
      }
    }

    return cleanLines.join('\n');
  }

  /**
   * Remove email signature
   */
  private static removeSignature(content: string): string {
    // Common signature separators
    const signaturePatterns = [
      /^--\s*$/m,                    // Standard separator
      /^---$/m,                     // Alternative separator
      /^______________________$/m,  // Underscore line
      /^Sent from my .*$/im,        // Mobile signature
      /^Best regards,?$/im,         // Common closings
      /^Regards,?$/im,
      /^Sincerely,?$/im,
      /^Thanks,?$/im,
      /^Thank you,?$/im,
    ];

    let cleaned = content;

    for (const pattern of signaturePatterns) {
      const match = cleaned.match(pattern);
      if (match && match.index) {
        cleaned = cleaned.substring(0, match.index).trim();
      }
    }

    return cleaned;
  }

  /**
   * Parse email addresses from string
   */
  static parseEmailAddresses(addresses: string): Array<{
    name?: string;
    email: string;
  }> {
    const results: Array<{ name?: string; email: string }> = [];
    
    // Match "Name" <email@domain.com> or just email@domain.com
    const regex = /(?:"?([^"<>]+)"?\s*)?<([^<>\s]+@[^<>\s]+)>/g;
    let match;

    while ((match = regex.exec(addresses)) !== null) {
      results.push({
        name: match[1]?.trim(),
        email: match[2].trim(),
      });
    }

    // If no matches, try simple email regex
    if (results.length === 0) {
      const simpleRegex = /([^<>\s]+@[^<>\s]+)/g;
      while ((match = simpleRegex.exec(addresses)) !== null) {
        results.push({
          email: match[1].trim(),
        });
      }
    }

    return results;
  }

  /**
   * Extract attachments info from email
   */
  static extractAttachments(payload: any): Array<{
    filename: string;
    contentType: string;
    size: number;
    url?: string;
  }> {
    const attachments = payload.attachments || [];
    
    return attachments.map((attachment: any) => ({
      filename: attachment.filename || attachment.name || 'unknown',
      contentType: attachment.type || 'application/octet-stream',
      size: attachment.size || 0,
      url: attachment.url,
    }));
  }
}
