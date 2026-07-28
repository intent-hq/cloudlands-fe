import { UNKNOWN_MODEL } from './token-usage-utils';

/**
 * Display-only mapping from raw backend `effective_model_name` values to
 * human-friendly labels for the token-usage UI. Aggregation/state stay keyed
 * by the raw name; this is applied only at render time.
 *
 * Known raw names verified against real session files (2026-06-12).
 */
const KNOWN_MODEL_LABELS: Record<string, string> = {
  // i18n-ignore (model product names, not translatable)
  'claude-fable-5-high-c4-p2-agent': 'Claude Fable 5 (High)',
  // i18n-ignore (model product names, not translatable)
  'claude-haiku-4-5-200k-v13-c4-p2-agent': 'Claude Haiku 4.5',
  // i18n-ignore (model product names, not translatable)
  'claude-sonnet-4-5-200k-v13-c4-p2-agent': 'Claude Sonnet 4.5',
  // i18n-ignore (model product names, not translatable)
  'claude-fruitcake-eap-high-c4-p2-agent': 'Claude Fruitcake EAP (High)',
  'gpt5-5-400k-v1-c4-p2-agent': 'GPT-5.5',
};

/**
 * Plumbing tokens stripped by the fallback heuristic: deployment/config
 * suffixes (`c4`, `p2`, `agent`), version tags (`v13`), context-window sizes
 * (`200k`, `1m`), and date stamps (`20250929`).
 */
const STRIP_TOKEN_PATTERNS: readonly RegExp[] = [
  /^agent$/,
  /^c\d+$/,
  /^p\d+$/,
  /^v\d+$/,
  /^\d+[km]$/,
  /^\d{8}$/,
];

/** Reasoning-effort tokens rendered as a parenthetical suffix, e.g. "(High)". */
const EFFORT_TOKENS = new Set(['low', 'medium', 'high', 'xhigh']);

const ACRONYMS: Record<string, string> = {
  gpt: 'GPT',
  glm: 'GLM',
  eap: 'EAP',
};

function formatToken(token: string): string {
  const acronym = ACRONYMS[token];
  if (acronym) return acronym;
  const match = token.match(/^([a-z]+)(\d.*)$/);
  if (match && ACRONYMS[match[1]]) return `${ACRONYMS[match[1]]}-${match[2]}`;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/**
 * Format a raw model name (e.g. `effective_model_name` from session billing
 * metadata) into a human-friendly display label.
 *
 * Known raw names map directly; unknown ones fall back to a heuristic that
 * strips plumbing suffix tokens, joins consecutive numeric tokens into a
 * version ("4-5" → "4.5"), and title-cases the rest. The `"unknown"` bucket
 * (and empty input) renders as "Unknown".
 */
export function formatModelLabel(rawModelName: string): string {
  const raw = typeof rawModelName === 'string' ? rawModelName.trim() : '';
  if (!raw || raw.toLowerCase() === UNKNOWN_MODEL) return 'Unknown';

  const known = KNOWN_MODEL_LABELS[raw];
  if (known) return known;

  const tokens = raw
    .toLowerCase()
    .split('-')
    .filter((token) => token && !STRIP_TOKEN_PATTERNS.some((pattern) => pattern.test(token)));
  if (tokens.length === 0) return raw;

  const efforts: string[] = [];
  while (tokens.length > 1 && EFFORT_TOKENS.has(tokens[tokens.length - 1])) {
    const effort = tokens.pop() as string;
    efforts.unshift(effort.charAt(0).toUpperCase() + effort.slice(1));
  }

  const parts: string[] = [];
  for (const token of tokens) {
    if (/^\d+$/.test(token) && parts.length > 0 && /\d$/.test(parts[parts.length - 1])) {
      parts[parts.length - 1] += `.${token}`;
      continue;
    }
    parts.push(formatToken(token));
  }

  const label = parts.join(' ');
  return efforts.length > 0 ? `${label} (${efforts.join(', ')})` : label;
}
