import { resolveHashToTarget } from '$shared/app-ui-targets';

export function getHighlightIdFromTarget(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin);
    const hash = decodeURIComponent(url.hash.replace(/^#/, '')).trim();
    return resolveHashToTarget(hash)?.id ?? (hash || null);
  } catch {
    const hashIndex = value.indexOf('#');
    const hash = hashIndex >= 0 ? value.slice(hashIndex + 1).trim() : '';
    return resolveHashToTarget(hash)?.id ?? (hash || null);
  }
}
