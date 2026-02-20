/**
 * Local Slug Generator
 *
 * Fast, local keyword extraction for workspace slugs.
 * No LLM calls - instant slug generation from the prompt.
 *
 * Format: word-word (e.g., "auth-refactor", "api-tests")
 * Collision handling (adding numeric suffix) is done by the workspace service.
 */

import { Logger } from '../../../shared/logger';

const logger = new Logger('LocalSlugGenerator');

// Common stop words to filter out
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'as',
  'is',
  'was',
  'are',
  'were',
  'been',
  'be',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'shall',
  'can',
  'need',
  'dare',
  'ought',
  'used',
  'that',
  'this',
  'these',
  'those',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'he',
  'him',
  'his',
  'she',
  'her',
  'it',
  'its',
  'they',
  'them',
  'their',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'where',
  'when',
  'why',
  'how',
  'all',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'also',
  'now',
  'here',
  'there',
  'then',
  'please',
  'help',
  'want',
  'like',
  'make',
  'get',
  'let',
  'put',
  'take',
  'give',
  'go',
  'come',
  'see',
  'look',
  'find',
  'use',
  'new',
  'way',
  'thing',
  'things',
]);

// Action words that are good for slugs when paired with a noun
const ACTION_WORDS = new Set([
  'add',
  'fix',
  'update',
  'create',
  'remove',
  'delete',
  'refactor',
  'improve',
  'implement',
  'build',
  'design',
  'test',
  'debug',
  'optimize',
  'migrate',
  'upgrade',
  'setup',
  'config',
  'deploy',
  'integrate',
  'connect',
  'sync',
  'validate',
  'check',
  'verify',
  'review',
  'clean',
  'format',
  'lint',
  'type',
]);

/**
 * Extract a slug from user prompt using local heuristics.
 * Fast and instant - no LLM calls.
 *
 * @param prompt - The user's initial prompt/intent
 * @returns A slug like "auth-refactor" or null if extraction failed
 */
export function extractLocalSlug(prompt: string): string | null {
  if (!prompt || prompt.trim().length < 3) {
    return null;
  }

  // Remove context mentions like @context[...] and @file[...]
  const cleanedPrompt = prompt
    .replace(/@(context|file|folder|symbol|url|image|linear|sentry|github)\[[^\]]*\]/gi, '')
    .trim();

  if (cleanedPrompt.length < 3) {
    return null;
  }

  // Extract words: lowercase, remove special chars, split on whitespace
  // Pattern for valid slug words: 2-15 lowercase letters only (no numbers)
  const validSlugWordPattern = /^[a-z]{2,15}$/;

  const words = cleanedPrompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+/, '')) // Strip leading hyphens to avoid invalid git branch names
    .map((w) => w.replace(/-+$/, '')) // Strip trailing hyphens to avoid double hyphens in slug
    .filter((w) => w.length >= 2 && w.length <= 15)
    .filter((w) => !STOP_WORDS.has(w))
    .filter((w) => validSlugWordPattern.test(w)); // Must be letters only (no numbers)

  if (words.length === 0) {
    return null;
  }

  // Strategy 1: Look for "action noun" pattern (e.g., "fix auth", "add dark mode")
  for (let i = 0; i < words.length - 1; i++) {
    if (ACTION_WORDS.has(words[i])) {
      const noun = words[i + 1];
      if (noun && !ACTION_WORDS.has(noun)) {
        logger.debug('Found action-noun pattern', { action: words[i], noun });
        return `${noun}-${words[i]}`; // "auth-fix" reads better than "fix-auth"
      }
    }
  }

  // Strategy 2: Look for "noun action" pattern (e.g., "auth refactor")
  for (let i = 0; i < words.length - 1; i++) {
    if (!ACTION_WORDS.has(words[i]) && ACTION_WORDS.has(words[i + 1])) {
      logger.debug('Found noun-action pattern', { noun: words[i], action: words[i + 1] });
      return `${words[i]}-${words[i + 1]}`;
    }
  }

  // Strategy 3: Take first two meaningful words
  if (words.length >= 2) {
    logger.debug('Using first two words', { word1: words[0], word2: words[1] });
    return `${words[0]}-${words[1]}`;
  }

  // Strategy 4: Single word - duplicate it or use a generic suffix
  if (words.length === 1) {
    logger.debug('Single word, adding generic suffix', { word: words[0] });
    return `${words[0]}-task`;
  }

  return null;
}

/**
 * Generate a base workspace slug from prompt using local extraction.
 * Returns just the base slug without any suffix.
 * Collision handling (adding numeric suffix) is done by the workspace service.
 *
 * @param prompt - The user's initial prompt/intent
 * @returns Base slug like "auth-fix" or null
 */
export function generateLocalSlug(prompt: string): string | null {
  const base = extractLocalSlug(prompt);
  if (!base) return null;

  logger.info('Generated local slug', { prompt: prompt.slice(0, 50), slug: base });
  return base;
}
