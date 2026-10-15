import { parseWorkspaceFileTarget } from './workspace-file-target';

export function isCommitHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);
}

/** Bounded return context only: neither read authority nor an arbitrary redirect. */
export function parseHistoryOrigin(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 8192) return;
  try {
    const v = JSON.parse(raw);
    if (
      !v ||
      typeof v.workspaceId !== 'string' ||
      !v.workspaceId ||
      !isCommitHash(v.hash) ||
      typeof v.path !== 'string' ||
      v.path.includes('\0') ||
      !parseWorkspaceFileTarget(v.path).valid ||
      !Number.isFinite(v.y) ||
      Math.abs(v.y) > 100000
    )
      return;
    return {
      workspaceId: v.workspaceId as string,
      hash: v.hash,
      path: v.path as string,
      y: v.y as number,
    };
  } catch {
    return;
  }
}
