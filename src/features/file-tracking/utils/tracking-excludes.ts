// App-level tracking suppression for untracked generated/dependency paths.
// Matching is exact by path segment; this does not mutate gitignore or hide
// tracked changes. Values inlined here from the retiring
// `features/file-tracking/tracking.config.ts` to keep this survivor
// self-contained.
export const DEFAULT_FILE_TRACKING_EXCLUDED_PATH_SEGMENTS = [
  'venv',
  '.venv',
  'virtualenv',
  'node_modules',
  'google-cloud-sdk',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.nox',
] as const;

export const DEFAULT_FILE_TRACKING_EXCLUDE_SAMPLE_LIMIT = 5;

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
