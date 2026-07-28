/**
 * Onboarding prompt suggestions — pre-canned prompts shown to users
 * in the "What should we build first?" step.
 */
import { m } from '$shared/paraglide/messages.js';

/** Message functions evaluated per call so suggestions follow the active locale. */
const SUGGESTION_MESSAGES = [
  m.onboarding_suggestions_silentErrors_prompt,
  m.onboarding_suggestions_writeTests_prompt,
  m.onboarding_suggestions_duplicateCode_prompt,
  m.onboarding_suggestions_requestFlow_prompt,
  m.onboarding_suggestions_inputValidation_prompt,
  m.onboarding_suggestions_extractConfig_prompt,
  m.onboarding_suggestions_performance_prompt,
  m.onboarding_suggestions_logging_prompt,
  m.onboarding_suggestions_docs_prompt,
  m.onboarding_suggestions_todos_prompt,
  m.onboarding_suggestions_security_prompt,
  m.onboarding_suggestions_docstrings_prompt,
  m.onboarding_suggestions_deadCode_prompt,
  m.onboarding_suggestions_errorMessages_prompt,
  m.onboarding_suggestions_dbQueries_prompt,
  m.onboarding_suggestions_readme_prompt,
  m.onboarding_suggestions_nullSafety_prompt,
  m.onboarding_suggestions_naming_prompt,
  m.onboarding_suggestions_typeAnnotations_prompt,
] as const;

export function getAllOnboardingSuggestions(): string[] {
  return SUGGESTION_MESSAGES.map((fn) => fn());
}

/**
 * Pick `count` random suggestions, optionally excluding a set already shown.
 */
export function getRandomSuggestions(count: number, exclude?: string[]): string[] {
  const all = getAllOnboardingSuggestions();
  const available = exclude ? all.filter((s) => !exclude.includes(s)) : all;
  const result: string[] = [];
  while (result.length < count && available.length > 0) {
    const idx = Math.floor(Math.random() * available.length);
    result.push(available.splice(idx, 1)[0]);
  }
  return result;
}
