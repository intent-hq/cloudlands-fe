import type { WorkspaceEvent } from '$features/events/types';
import { hasDefaultFileTrackingExcludedSegment } from '$features/file-tracking/utils/tracking-excludes';

const STATUS_UPDATE_FIELDS = new Set(['lastActivity', 'statusMessage', 'statusImageAssetId']);
const ACTIVITY_EVENT_PREFIXES = ['agent:', 'note:', 'task:'] as const;
const GENERATED_ACTIVITY_PATH_SEGMENTS = new Set([
  '.git',
  '.playwright-cli',
  '.svelte-kit',
  '.vite',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.next',
  '.nuxt',
  '.output',
  'build',
  'coverage',
  'dist',
  'playwright-report',
  'target',
  'test-results',
]);

function pathSegments(filePath: string): string[] {
  return filePath
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');
}

function getActivityFilePath(event: WorkspaceEvent): string | null {
  if (!event.type.startsWith('file:')) return null;
  const data = event.data as Record<string, unknown> | undefined;
  const path = data?.relativePath ?? data?.path ?? data?.filePath;
  return typeof path === 'string' && path.length > 0 ? path : null;
}

export function isSourceFileActivityEvent(event: WorkspaceEvent): boolean {
  const filePath = getActivityFilePath(event);
  if (!filePath || hasDefaultFileTrackingExcludedSegment(filePath)) return false;
  return !pathSegments(filePath).some((segment) => GENERATED_ACTIVITY_PATH_SEGMENTS.has(segment));
}

/** Keep activity history focused on work performed by agents and project edits. */
export function shouldShowWorkspaceActivityEvent(event: WorkspaceEvent): boolean {
  return (
    ACTIVITY_EVENT_PREFIXES.some((prefix) => event.type.startsWith(prefix)) ||
    isSourceFileActivityEvent(event)
  );
}

/**
 * Status copy, its optional image, and derived display-status transitions are
 * transient workspace presentation data, not meaningful activity-log history.
 * Preserve mixed updates so changes to titles, branches, tags, or lifecycle
 * status remain visible.
 */
export function isWorkspaceStatusUpdateEvent(event: WorkspaceEvent): boolean {
  if (event.type === 'workspace:displayStatus-changed') return true;
  if (event.type !== 'workspace:updated') return false;
  const data = event.data as { changes?: unknown } | undefined;
  if (!data?.changes || typeof data.changes !== 'object' || Array.isArray(data.changes)) {
    return false;
  }
  const fields = Object.keys(data.changes).filter((field) => field !== 'workspaceId');
  return fields.length > 0 && fields.every((field) => STATUS_UPDATE_FIELDS.has(field));
}
