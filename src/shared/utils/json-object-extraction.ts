/**
 * Tolerant JSON-object location for LLM completion texts.
 *
 * Dependency-light (no stores, services, or side effects) and shared between
 * the renderer background-executor extraction and the main-process slug
 * generator so both use the same scanning strategy.
 */

/**
 * Locate and parse a JSON object in a completion text. Tolerates a wrapping
 * code fence and surrounding prose: scans from each `{` to its balanced `}`
 * (string-aware) and returns the first candidate that parses to a plain
 * object satisfying `isValid` — objects that parse but fail the predicate
 * (e.g. a bare `{}` in prose before the real payload) are skipped. When no
 * candidate satisfies the predicate, the first parsed object is returned so
 * callers can diagnose the missing field.
 */
export function parseJsonObject(
  text: string,
  isValid: (obj: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  let firstParsed: Record<string, unknown> | null = null;
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          try {
            const parsed: unknown = JSON.parse(text.slice(start, i + 1));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const obj = parsed as Record<string, unknown>;
              if (isValid(obj)) return obj;
              firstParsed ??= obj;
            }
          } catch {
            // Not valid JSON — try the next `{`.
          }
          break;
        }
      }
    }
  }
  return firstParsed;
}
