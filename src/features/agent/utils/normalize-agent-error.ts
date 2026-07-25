/**
 * Normalize an `agent:failed` error string into a stable grouping key.
 *
 * `agent:failed` carries no structured error code — only `data.error: string`
 * (see PROTOCOL §7) — so the failure-aggregation registry groups failures by
 * the error text with obviously variable fragments stripped: UUIDs, filesystem
 * paths, hex identifiers, and numbers. Two agents failing with the same
 * connectivity error (differing only in ids/ports/paths) normalize to one key;
 * genuinely different errors stay distinct.
 *
 * Pure function, dependency-light per AGENTS.md utils conventions.
 */

/** Canonical UUIDs (8-4-4-4-12 hex). Replaced before the hex/number passes. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Filesystem-ish paths: two or more `/segment` runs (optionally preceded by a
 * Windows drive letter). Replaced before hex/number so path characters do not
 * get partially rewritten.
 */
const PATH_RE = /(?:[A-Za-z]:)?(?:\/[\w.@~-]+){2,}\/?/g;

/** `0x…` literals or bare hex runs of 8+ chars (request/session ids, hashes). */
const HEX_RE = /\b(?:0x[0-9a-f]+|[0-9a-f]{8,})\b/gi;

/** Any remaining digit run (ports, counts, timestamps, retry numbers). */
const NUM_RE = /\d+/g;

/**
 * Produce the group key for an agent failure error string. Case-insensitive,
 * whitespace-collapsed, with variable fragments replaced by placeholders.
 * Empty/blank input maps to `<unknown>` so callers always get a usable key.
 */
export function normalizeAgentError(error: string): string {
  const normalized = error
    .replace(UUID_RE, '<id>')
    .replace(PATH_RE, '<path>')
    .replace(HEX_RE, '<hex>')
    .replace(NUM_RE, '<n>')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 0 ? normalized : '<unknown>';
}
