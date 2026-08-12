/**
 * Result extraction utilities for background agent execution.
 *
 * Extracts structured results from agent messages by parsing
 * result tags and patterns from content.
 */

import { extractAllContent } from '$shared/types';
import type { AgentMessage } from '$shared/types/agent.types';
import { parseJsonObject } from '$shared/utils/json-object-extraction';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('BgExecutorResultExtraction');

/**
 * Clean model fallback status messages from content.
 */
export function cleanModelFallbackMessages(content: string): string {
  if (!content) return content;

  let cleaned = content;
  // i18n-ignore (matches model-fallback status text emitted in English)
  cleaned = cleaned.replace(/>\s*⚠️\s*Model\s*`[^`]*`\s*is not available\..*?\n\n?/gi, '');
  cleaned = cleaned.replace(/>\s*❌\s*\*\*All models unavailable\*\*[\s\S]*?(?=\n\n|$)/gi, '');
  cleaned = cleaned.replace(/>\s*⚠️[^\n]*Model[^\n]*not available[^\n]*\n\n?/gi, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

/**
 * Extract result from a raw completion text (one-shot `agent.completeOnce`
 * replies, PROTOCOL §5.32). Same tag semantics as
 * `extractResultFromMessages`: when `resultTag` is set the tagged block is
 * required and its absence is an error; without a tag the full cleaned text
 * is the result.
 */
export function extractResultFromText(
  content: string,
  resultTag?: string,
): { result: string | null; error: string | null } {
  const cleaned = cleanModelFallbackMessages(content ?? '');

  if (!resultTag) {
    const trimmed = cleaned.trim();
    return trimmed.length > 0
      ? { result: trimmed, error: null }
      : // i18n-ignore (internal extraction diagnostic)
        { result: null, error: 'Empty response from model' };
  }

  const tagRegex = new RegExp(`<<<${resultTag}>>>([\\s\\S]*?)<<<\\/${resultTag}>>>`, 'i');
  const match = cleaned.match(tagRegex);
  if (match) {
    return { result: match[1].trim(), error: null };
  }

  logger.warn(
    // i18n-ignore (developer log message)
    `Expected <${resultTag}> tag not found in response. ` +
      // i18n-ignore (developer log message)
      'The model did not follow the expected output format.',
    { contentLength: cleaned.length, contentPreview: cleaned.substring(0, 200) },
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

/**
 * Extract a JSON object result from a raw completion text (one-shot
 * `agent.completeOnce` replies, PROTOCOL §5.32). Tolerates a wrapping code
 * fence and surrounding prose; `schemaHint` names the expected shape in
 * diagnostics. `isValid` drives the scan: candidate objects that parse but
 * fail it are skipped in favor of a later valid one (falling back to the
 * first parsed object so the caller can report which field is missing).
 */
export function extractJsonObjectFromText(
  content: string,
  schemaHint: string,
  isValid: (obj: Record<string, unknown>) => boolean,
): { json: Record<string, unknown> | null; error: string | null } {
  const cleaned = cleanModelFallbackMessages(content ?? '').trim();
  if (!cleaned) {
    // i18n-ignore (internal extraction diagnostic)
    return { json: null, error: 'Empty response from model' };
  }

  const json = parseJsonObject(cleaned, isValid);
  if (!json) {
    logger.warn(
      // i18n-ignore (developer log message)
      `Expected a JSON object ${schemaHint} in response. ` +
        // i18n-ignore (developer log message)
        'The model did not follow the expected output format.',
      { contentLength: cleaned.length, contentPreview: cleaned.substring(0, 200) },
    );
    return {
      json: null,
      error:
        // i18n-ignore (internal extraction diagnostic)
        `Expected a JSON object ${schemaHint} in response. ` +
        // i18n-ignore (internal extraction diagnostic)
        'Please try again or use a different model.',
    };
  }
  return { json, error: null };
}

/** Diagnostic for a JSON reply whose required field is missing or empty. */
function missingFieldResult(
  field: string,
  schemaHint: string,
  content: string,
): { result: string | null; error: string | null } {
  logger.warn(
    // i18n-ignore (developer log message)
    `JSON response is missing a non-empty "${field}" (expected ${schemaHint}).`,
    { contentLength: content.length, contentPreview: content.substring(0, 200) },
  );
  return {
    result: null,
    error:
      // i18n-ignore (internal extraction diagnostic)
      `JSON response is missing a non-empty "${field}" (expected ${schemaHint}). ` +
      // i18n-ignore (internal extraction diagnostic)
      'Please try again or use a different model.',
  };
}

/**
 * Normalize a single-line-by-contract field (`subject`/`title`): collapse
 * internal whitespace (including embedded newlines, which would corrupt the
 * downstream first-line shapes) into single spaces and trim.
 */
function singleLineField(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Extract a commit message from a JSON reply `{"subject": string, "body"?:
 * string}` and format it into the downstream shape: `subject`, or
 * `subject\n\nbody` when a body is present.
 */
export function extractCommitResultFromText(content: string): {
  result: string | null;
  error: string | null;
} {
  const schemaHint = '{"subject": string, "body"?: string}';
  const { json, error } = extractJsonObjectFromText(
    content,
    schemaHint,
    (obj) => singleLineField(obj.subject) !== '',
  );
  if (!json) return { result: null, error };

  const subject = singleLineField(json.subject);
  if (!subject) return missingFieldResult('subject', schemaHint, content);

  const body = typeof json.body === 'string' ? json.body.trim() : '';
  return { result: body ? `${subject}\n\n${body}` : subject, error: null };
}

/**
 * Extract a PR description from a JSON reply `{"title": string, "body":
 * string}` — both fields required — and format it into the downstream shape
 * `# {title}\n\n{body}` (consumers split on the first-line heading).
 */
export function extractPrResultFromText(content: string): {
  result: string | null;
  error: string | null;
} {
  const schemaHint = '{"title": string, "body": string}';
  const { json, error } = extractJsonObjectFromText(
    content,
    schemaHint,
    (obj) =>
      singleLineField(obj.title) !== '' &&
      typeof obj.body === 'string' &&
      obj.body.trim() !== '',
  );
  if (!json) return { result: null, error };

  const title = singleLineField(json.title);
  if (!title) return missingFieldResult('title', schemaHint, content);

  const body = typeof json.body === 'string' ? json.body.trim() : '';
  if (!body) return missingFieldResult('body', schemaHint, content);

  return { result: `# ${title}\n\n${body}`, error: null };
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
      // i18n-ignore (developer log message)
      `Expected <${resultTag}> tag not found in response. ` +
        // i18n-ignore (developer log message)
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
