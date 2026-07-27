/**
 * Locale negotiation for i18n — pure and dependency-light so it can run in the
 * renderer, TS modules, and the Electron main process.
 *
 * Resolution order (spec Decisions 2026-07-27):
 * 1. An explicit user preference wins when its catalog exists.
 * 2. Otherwise the system locale(s) are best-matched against the available
 *    catalogs via language + likely-script negotiation (`de-AT` → `de`;
 *    `zh`/`zh-SG`/`zh-Hans-*` → `zh-CN`; Traditional `zh-TW`/`zh-HK` stay
 *    unmatched until a zh-Hant catalog ships).
 * 3. If nothing matches, the base locale (`en`) is used.
 *
 * The matcher is catalog-driven: it takes the available locales as input, so
 * new catalogs added to `project.inlang` participate automatically.
 */

/** Sentinel preference meaning "follow the OS locale". */
export const SYSTEM_LANGUAGE_PREFERENCE = 'system';

interface LikelySubtags {
  language: string;
  script: string;
  region: string;
}

/**
 * Expand a BCP-47 tag to its likely language/script/region subtags
 * (`zh` → zh/Hans/CN, `zh-TW` → zh/Hant/TW, `de-AT` → de/Latn/AT).
 * Returns null for tags `Intl.Locale` cannot parse.
 */
function likelySubtags(tag: string): LikelySubtags | null {
  try {
    const maximized = new Intl.Locale(tag).maximize();
    return {
      language: maximized.language ?? '',
      script: maximized.script ?? '',
      region: maximized.region ?? '',
    };
  } catch {
    return null;
  }
}

function findExact(tag: string, available: readonly string[]): string | undefined {
  const lowered = tag.toLowerCase();
  return available.find((candidate) => candidate.toLowerCase() === lowered);
}

/**
 * Best-match an ordered list of requested locales against the available
 * catalogs. For each requested tag: exact match first, then a
 * language + likely-script match (preferring a same-region catalog). Requested
 * tags whose script has no catalog (e.g. `zh-TW` with only `zh-CN` shipped)
 * are skipped rather than mismatched. Returns `fallback` when nothing matches.
 */
export function matchLocale(
  requested: readonly string[],
  available: readonly string[],
  fallback: string,
): string {
  for (const tag of requested) {
    if (typeof tag !== 'string' || tag.trim() === '') continue;

    const exact = findExact(tag, available);
    if (exact) return exact;

    const wanted = likelySubtags(tag);
    if (!wanted || wanted.language === '') continue;

    const candidates = available.filter((candidate) => {
      const subtags = likelySubtags(candidate);
      return (
        subtags !== null &&
        subtags.language === wanted.language &&
        subtags.script === wanted.script
      );
    });
    if (candidates.length > 0) {
      const sameRegion = candidates.find(
        (candidate) => likelySubtags(candidate)?.region === wanted.region,
      );
      return sameRegion ?? candidates[0];
    }
  }
  return fallback;
}

/**
 * Resolve the effective locale from a stored preference: explicit setting
 * wins when its catalog exists, otherwise the system locales are best-matched
 * against the catalogs, otherwise `fallback`.
 */
export function resolveLocale(
  preference: string,
  systemLocales: readonly string[],
  available: readonly string[],
  fallback: string,
): string {
  if (
    typeof preference === 'string' &&
    preference.trim() !== '' &&
    preference !== SYSTEM_LANGUAGE_PREFERENCE
  ) {
    const exact = findExact(preference, available);
    if (exact) return exact;
  }
  return matchLocale(systemLocales, available, fallback);
}
