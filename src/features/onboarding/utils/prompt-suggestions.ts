/**
 * Onboarding prompt suggestions — pre-canned prompts shown to users
 * in the "What should we build first?" step.
 */

export const ALL_ONBOARDING_SUGGESTIONS = [
  'Find every error that gets silently ignored and fix it.',
  'Write tests for the most important parts of this project.',
  'Find copy-pasted code and clean it up.',
  'Map out what happens when a user makes a request, step by step.',
  "Find anywhere user input isn't being validated and add it.",
  'Pull out all hardcoded passwords, URLs, and config values into proper settings.',
  'Find the slowest parts of the code and speed them up.',
  "Add helpful logging anywhere it's missing.",
  'Generate documentation based on what the code actually does.',
  'Find all the TODO and FIXME comments and resolve them.',
  'Check for security vulnerabilities and fix the most critical ones.',
  'Make sure every public function has a clear description.',
  'Find unused code and dead imports, then remove them.',
  'Add proper error messages that would actually help a developer debug.',
  'Check every database query for performance issues and fix them.',
  'Make the README accurate based on the current state of the code.',
  "Find anywhere we're not handling null or empty values safely.",
  'Standardize the naming conventions across the whole project.',
  "Add type annotations everywhere they're missing.",
] as const;

/**
 * Pick `count` random suggestions, optionally excluding a set already shown.
 */
export function getRandomSuggestions(count: number, exclude?: string[]): string[] {
  const available = exclude
    ? ALL_ONBOARDING_SUGGESTIONS.filter((s) => !exclude.includes(s))
    : [...ALL_ONBOARDING_SUGGESTIONS];
  const result: string[] = [];
  while (result.length < count && available.length > 0) {
    const idx = Math.floor(Math.random() * available.length);
    result.push(available.splice(idx, 1)[0]);
  }
  return result;
}
