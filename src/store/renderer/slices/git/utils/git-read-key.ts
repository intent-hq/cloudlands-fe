import type { GitReadRequest } from '../git-types';

/** Stable resource identity; consumers and request generations are tracked separately. */
export function gitReadKey(request: GitReadRequest): string {
  return JSON.stringify(
    Object.entries(request)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
