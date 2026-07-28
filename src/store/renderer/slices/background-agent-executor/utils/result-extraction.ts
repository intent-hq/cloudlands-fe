/**
 * Result extraction utilities for background agent execution.
 *
 * Extracts structured results from agent messages by parsing
 * result tags and patterns from content.
 */

import { extractAllContent } from '$shared/types';
import type { AgentMessage } from '$shared/types/agent.types';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('BgExecutorResultExtraction');

/**
 * Clean model fallback status messages from content.
 */
export function cleanModelFallbackMessages(content: string): string {
  if (!content) return content;

  let cleaned = content;
  cleaned = cleaned.replace(/>\s*⚠️\s*Model\s*`[^`]*`\s*is not available\..*?\n\n?/gi, '');
  cleaned = cleaned.replace(/>\s*❌\s*\*\*All models unavailable\*\*[\s\S]*?(?=\n\n|$)/gi, '');
  cleaned = cleaned.replace(/>\s*⚠️[^\n]*Model[^\n]*not available[^\n]*\n\n?/gi, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

/**
 * Extract result from agent messages.
 *
 * @param messages - The agent messages to extract from
 * @param resultTag - Optional tag to search for (e.g., "COMMIT_MESSAGE")
 * @param resultPattern - Optional regex pattern string to match
 * @param forceExtract - If true, set error when tag not found (used on completion)
 * @returns Object with extracted result and optional error
 */
export function extractResultFromMessages(
  messages: AgentMessage[],
  resultTag?: string,
  resultPattern?: string,
  forceExtract = false,
): { result: string | null; error: string | null } {
  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  if (assistantMessages.length === 0) return { result: null, error: null };

  let content: string | null = null;
  let extractedResult: string | null = null;

  if (resultTag || resultPattern) {
    const tagRegex = resultTag
      ? new RegExp(`<<<${resultTag}>>>([\\s\\S]*?)<<<\\/${resultTag}>>>`, 'i')
      : null;
    const patternRegex = resultPattern ? new RegExp(resultPattern) : null;

    for (let i = assistantMessages.length - 1; i >= 0; i--) {
      const msgContent = extractAllContent(assistantMessages[i]);
      if (!msgContent || typeof msgContent !== 'string') continue;

      const cleaned = cleanModelFallbackMessages(msgContent);

      if (tagRegex && !extractedResult) {
        const match = cleaned.match(tagRegex);
        if (match) {
          extractedResult = match[1].trim();
          content = cleaned;
          break;
        }
      }

      if (!extractedResult && patternRegex) {
        const match = cleaned.match(patternRegex);
        if (match) {
          extractedResult = match[1] || match[0];
          content = cleaned;
          break;
        }
      }
    }
  }

  // Fall back to last message content
  if (!content) {
    const lastMessage = assistantMessages[assistantMessages.length - 1];
    const lastContent = extractAllContent(lastMessage);
    if (!lastContent || typeof lastContent !== 'string') return { result: null, error: null };

    const originalContent = lastContent;
    content = cleanModelFallbackMessages(lastContent);

    if (content !== originalContent) {
      logger.info('Cleaned model fallback messages from content', {
        originalLength: originalContent.length,
        cleanedLength: content.length,
      });
    }
  }

  // Fallback: use entire content ONLY if no extraction method was specified
  if (!extractedResult && !resultTag && !resultPattern) {
    extractedResult = content.trim();
  }

  // If tag was specified but not found, log a warning
  if (!extractedResult && resultTag && forceExtract) {
    logger.warn(
      `Expected <${resultTag}> tag not found in response. ` +
        'The model did not follow the expected output format.',
      { contentLength: content.length, contentPreview: content.substring(0, 200) },
    );
    return {
      result: null,
      error:
        // i18n-ignore (internal extraction diagnostic)
        `Expected <${resultTag}> tag not found in response. ` +
        // i18n-ignore (internal extraction diagnostic)
        'Please try again or use a different model.',
    };
  }

  return { result: extractedResult, error: null };
}
