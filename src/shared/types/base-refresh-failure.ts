/**
 * `workspace.create` base-refresh failure (PROTOCOL §9.2): the daemon's
 * required `git fetch <remote> <baseRef>` failed before the checkout was made.
 * Wire shape: `-32603`, readable `message`, and
 * `error.data = { code: "base-refresh-failed", category, detail, baseRef, remote }`.
 * The code gates behavior (Continue from last-fetched), the category picks
 * guidance, and `detail` (redacted by the daemon) is what users see.
 */

export const BASE_REFRESH_FAILED_CODE = 'base-refresh-failed';

const BASE_REFRESH_CATEGORIES = [
  'auth-required',
  'ssh-host-key',
  'network',
  'timeout',
  'repo-not-found',
  'access-denied',
  'other',
] as const;

export type BaseRefreshCategory = (typeof BASE_REFRESH_CATEGORIES)[number];

export interface BaseRefreshFailure {
  category: BaseRefreshCategory;
  detail: string;
  baseRef: string;
  remote: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Read a `base-refresh-failed` payload from a transport error's `data`.
 * Undefined for any other code; an unknown category reads as `other` (§9.2).
 */
export function parseBaseRefreshFailure(data: unknown): BaseRefreshFailure | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  if (record.code !== BASE_REFRESH_FAILED_CODE) return undefined;
  const category = (BASE_REFRESH_CATEGORIES as readonly string[]).includes(text(record.category))
    ? (record.category as BaseRefreshCategory)
    : 'other';
  return {
    category,
    detail: text(record.detail),
    baseRef: text(record.baseRef),
    remote: text(record.remote),
  };
}
