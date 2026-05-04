import { TRACKING_CONFIG } from '../tracking.config';

export const DEFAULT_FILE_TRACKING_EXCLUDED_PATH_SEGMENTS =
  TRACKING_CONFIG.fileTracking.defaultExcludedPathSegments;

export const DEFAULT_FILE_TRACKING_EXCLUDE_SAMPLE_LIMIT =
  TRACKING_CONFIG.fileTracking.defaultExcludeSampleLimit;

export interface FileTrackingExcludeCandidate {
  path?: string;
  action?: string;
  stage?: string;
  statusCode?: string;
}

export interface FileTrackingExcludeSummary {
  skippedCount: number;
  skippedSample: string[];
  excludedSegments: readonly string[];
}

function getPathSegments(filePath: string): string[] {
  return filePath
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');
}

export function hasDefaultFileTrackingExcludedSegment(filePath: string): boolean {
  const excludedSegments = new Set<string>(DEFAULT_FILE_TRACKING_EXCLUDED_PATH_SEGMENTS);
  return getPathSegments(filePath).some((segment) => excludedSegments.has(segment));
}

function isUntrackedCreateCandidate(candidate: FileTrackingExcludeCandidate): boolean {
  if (candidate.statusCode === '??') {
    return true;
  }

  const action = candidate.action?.toLowerCase();
  if (action !== 'create' && action !== 'add' && action !== 'added') {
    return false;
  }

  return candidate.stage?.toLowerCase() !== 'staged';
}

export function shouldExcludeFromDefaultFileTracking(
  candidate: FileTrackingExcludeCandidate,
): boolean {
  return (
    !!candidate.path &&
    isUntrackedCreateCandidate(candidate) &&
    hasDefaultFileTrackingExcludedSegment(candidate.path)
  );
}

export function partitionDefaultFileTrackingExcludes<T>(
  items: T[],
  getCandidate: (item: T) => FileTrackingExcludeCandidate,
): { kept: T[]; skipped: T[] } {
  const kept: T[] = [];
  const skipped: T[] = [];

  for (const item of items) {
    if (shouldExcludeFromDefaultFileTracking(getCandidate(item))) {
      skipped.push(item);
    } else {
      kept.push(item);
    }
  }

  return { kept, skipped };
}

export function summarizeDefaultFileTrackingExcludes(paths: string[]): FileTrackingExcludeSummary {
  return {
    skippedCount: paths.length,
    skippedSample: paths.slice(0, DEFAULT_FILE_TRACKING_EXCLUDE_SAMPLE_LIMIT),
    excludedSegments: DEFAULT_FILE_TRACKING_EXCLUDED_PATH_SEGMENTS,
  };
}
