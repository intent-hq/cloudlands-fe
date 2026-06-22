import type { WorkspaceEvent } from '../../../../../features/events/types';
import type { SerializableDataMatcher } from '../types';

function getNestedValue(obj: Record<string, unknown>, field: string): unknown {
  const parts = field.split('.');
  let value: unknown = obj;
  for (const part of parts) {
    if (value == null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function matchesDataMatcher(
  event: WorkspaceEvent,
  matcher: SerializableDataMatcher,
): boolean {
  const actual = getNestedValue(event as unknown as Record<string, unknown>, matcher.field);

  switch (matcher.operator) {
    case 'equals':
      return actual === matcher.value;
    case 'contains':
      return typeof actual === 'string' && typeof matcher.value === 'string' && actual.includes(matcher.value);
    case 'starts_with':
      return typeof actual === 'string' && typeof matcher.value === 'string' && actual.startsWith(matcher.value);
    case 'ends_with':
      return typeof actual === 'string' && typeof matcher.value === 'string' && actual.endsWith(matcher.value);
    case 'matches': {
      if (typeof actual !== 'string') return false;
      try {
        if (typeof matcher.value === 'string') {
          return new RegExp(matcher.value).test(actual);
        }
        if (
          typeof matcher.value === 'object' &&
          matcher.value !== null &&
          'pattern' in matcher.value &&
          typeof matcher.value.pattern === 'string'
        ) {
          return new RegExp(matcher.value.pattern, matcher.value.flags).test(actual);
        }
        return false;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

export function matchesDataMatchers(
  event: WorkspaceEvent,
  matchers: SerializableDataMatcher[] | undefined,
): boolean {
  return !matchers?.length || matchers.every((matcher) => matchesDataMatcher(event, matcher));
}