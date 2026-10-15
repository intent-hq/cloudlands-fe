import { sanitizeToolText } from './tool-display-model';

export const FEATURED_INPUT_KEYS = new Set([
  'information_request', // codebase-retrieval
  'query', // search tools
  'thought', // sequential thinking
  'memory', // remember tool
  'search_query_regex', // view tool with regex search
]);

function formatValue(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string') {
    const sanitized = sanitizeToolText(val);
    return sanitized.length > 150 ? sanitized.slice(0, 150) + '…' : sanitized;
  }
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val))
    return val.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
  try {
    const json = JSON.stringify(val, null, 2);
    return json.length > 150 ? json.slice(0, 150) + '…' : json;
  } catch {
    return String(val);
  }
}

/** Source ToolDetails raw-input eligibility; callers supply the sanitized payload. */
export function getToolInputEntries(sanitizedInput: Record<string, unknown> | null | undefined) {
  if (!sanitizedInput) return null;
  const entries: Array<{ key: string; value: string }> = [];
  for (const [key, val] of Object.entries(sanitizedInput)) {
    if (val == null) continue;
    // Skip very long values in the summary (like file_content, instructions_reminder)
    if (FEATURED_INPUT_KEYS.has(key)) continue;
    // Skip internal metadata fields (e.g., _acpTitle used for path extraction fallback)
    if (key.startsWith('_')) continue;
    const formatted = formatValue(val);
    if (formatted) entries.push({ key, value: formatted });
  }
  return entries.length > 0 ? entries : null;
}
