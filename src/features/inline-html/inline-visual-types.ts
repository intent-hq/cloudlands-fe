/** JSON only: authored visuals never pass executable values to the app. */
export type InlineVisualValue =
  null | boolean | number | string | InlineVisualValue[] | { [key: string]: InlineVisualValue };

export interface InlineVisualSnapshot {
  state: InlineVisualValue;
  title: string;
  inputs: Record<string, InlineVisualValue>;
  results: Record<string, InlineVisualValue>;
}

interface InlineVisualScenario {
  id: string;
  name: string;
  snapshot: InlineVisualSnapshot;
}

export interface InlineVisualRecord {
  version: 1;
  current: InlineVisualSnapshot | null;
  scenarios: InlineVisualScenario[];
}

export interface InlineVisualIdentity {
  workspaceId: string;
  agentId: string;
  messageId: string;
  blockKey: string;
  source: string;
}

export const INLINE_VISUAL_MAX_BYTES = 65_536;
export const INLINE_VISUAL_MAX_SCENARIOS = 6;

/** Self-contained because the same validator runs inside both opaque frames. */
export function isInlineVisualSnapshot(value: unknown): value is InlineVisualSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (
    Object.keys(entry).some((key) => !['state', 'title', 'inputs', 'results'].includes(key)) ||
    !Object.hasOwn(entry, 'state') ||
    typeof entry.title !== 'string' ||
    !entry.title.trim() ||
    entry.title.length > 160
  )
    return false;
  let remaining = 4096;
  const jsonValue = (item: unknown, depth: number): boolean => {
    if (--remaining < 0 || depth > 12) return false;
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (!item || typeof item !== 'object') return false;
    if (Array.isArray(item)) return item.every((child) => jsonValue(child, depth + 1));
    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      return false;
    return Object.entries(item).every(
      ([key, child]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) && jsonValue(child, depth + 1),
    );
  };
  for (const name of ['inputs', 'results']) {
    const fields = entry[name];
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return false;
    if (Object.keys(fields).length > 32 || Object.keys(fields).some((key) => key.length > 120))
      return false;
  }
  try {
    return jsonValue(entry, 0) && new TextEncoder().encode(JSON.stringify(entry)).length <= 65_536;
  } catch {
    return false;
  }
}

export function emptyInlineVisualRecord(): InlineVisualRecord {
  return { version: 1, current: null, scenarios: [] };
}

export function isInlineVisualRecord(value: unknown): value is InlineVisualRecord {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<InlineVisualRecord>;
  return (
    Object.keys(entry).every((key) => ['version', 'current', 'scenarios'].includes(key)) &&
    entry.version === 1 &&
    (entry.current === null || isInlineVisualSnapshot(entry.current)) &&
    Array.isArray(entry.scenarios) &&
    entry.scenarios.length <= INLINE_VISUAL_MAX_SCENARIOS &&
    new Set(entry.scenarios.map((scenario) => scenario?.id)).size === entry.scenarios.length &&
    entry.scenarios.every(
      (scenario) =>
        scenario &&
        Object.keys(scenario).every((key) => ['id', 'name', 'snapshot'].includes(key)) &&
        typeof scenario.id === 'string' &&
        /^[a-zA-Z0-9-]{1,80}$/.test(scenario.id) &&
        typeof scenario.name === 'string' &&
        scenario.name.trim().length > 0 &&
        scenario.name.length <= 120 &&
        isInlineVisualSnapshot(scenario.snapshot),
    )
  );
}
