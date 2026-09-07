import { describe, expect, it } from 'vitest';
import { ChangeStage, type TrackedChange } from '../types';
import {
  DEFAULT_FILE_TRACKING_EXCLUDED_PATH_SEGMENTS,
  hasDefaultFileTrackingExcludedSegment,
  isUntrackedChange,
  isUntrackedStatusCode,
  partitionDefaultFileTrackingExcludes,
  shouldExcludeFromDefaultFileTracking,
  summarizeDefaultFileTrackingExcludes,
} from '../utils/tracking-excludes';

describe('tracking-excludes', () => {
  it('identifies only unstaged added tracked-change rows as untracked', () => {
    const change: TrackedChange = {
      id: 'change-1',
      file: 'src/new.ts',
      relativePath: 'src/new.ts',
      stage: ChangeStage.Unstaged,
      status: 'added',
      stats: { additions: 1, deletions: 0 },
      attribution: { timestamp: 0 },
    };

    expect(isUntrackedChange(change)).toBe(true);
    expect(isUntrackedChange({ ...change, stage: ChangeStage.Staged })).toBe(false);
    expect(isUntrackedChange({ ...change, status: 'modified' })).toBe(false);
    expect(isUntrackedChange({ ...change, stage: ChangeStage.Committed })).toBe(false);
  });

  it('recognizes raw and normalized secondary-root untracked status codes', () => {
    expect(isUntrackedStatusCode('??')).toBe(true);
    expect(isUntrackedStatusCode('?')).toBe(true);
    expect(isUntrackedStatusCode('M')).toBe(false);
  });

  it('includes the default generated dependency/cache directory segments', () => {
    expect(DEFAULT_FILE_TRACKING_EXCLUDED_PATH_SEGMENTS).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });

  it('matches exact path segments, not substrings', () => {
    const excludedPaths = [
      'venv/lib/python3.11/site-packages/pkg.py',
      '.venv/lib/python3.11/site-packages/pkg.py',
      'services/api/virtualenv/lib/python3.11/site-packages/pkg.py',
      'node_modules/pkg/index.js',
      'google-cloud-sdk/platform/gsutil/gslib/__init__.py',
      'src\\__pycache__\\module.pyc',
      'pkg/.tox/py311/tmp.py',
      'pkg/.nox/session/tmp.py',
    ];

    for (const path of excludedPaths) {
      expect(hasDefaultFileTrackingExcludedSegment(path), path).toBe(true);
    }

    const nonExcludedPaths = [
      'src/venv_utils.ts',
      'tests/fixtures/venv-example.txt',
      'environment/config.py',
      'src/virtualenv-tools/index.ts',
      'packages/node_modules_utils.ts',
      'tools/google-cloud-sdk-helper.ts',
      'cache/.toxicity/config',
    ];

    for (const path of nonExcludedPaths) {
      expect(hasDefaultFileTrackingExcludedSegment(path), path).toBe(false);
    }
  });

  it('only excludes untracked/create-like candidates under excluded segments', () => {
    expect(
      shouldExcludeFromDefaultFileTracking({ path: 'venv/lib/pkg.py', action: 'Create' }),
    ).toBe(true);
    expect(
      shouldExcludeFromDefaultFileTracking({ path: 'venv/lib/pkg.py', statusCode: '??' }),
    ).toBe(true);
    expect(
      shouldExcludeFromDefaultFileTracking({
        path: 'google-cloud-sdk/platform/gsutil/gslib/__init__.py',
        statusCode: '??',
      }),
    ).toBe(true);

    expect(
      shouldExcludeFromDefaultFileTracking({ path: '.venv/lib/pkg.py', statusCode: ' M' }),
    ).toBe(false);
    expect(
      shouldExcludeFromDefaultFileTracking({ path: '.venv/lib/pkg.py', statusCode: 'A ' }),
    ).toBe(false);
    expect(
      shouldExcludeFromDefaultFileTracking({ path: '.venv/lib/pkg.py', statusCode: 'D ' }),
    ).toBe(false);
    expect(
      shouldExcludeFromDefaultFileTracking({
        path: 'google-cloud-sdk/platform/gsutil/gslib/__init__.py',
        statusCode: ' M',
      }),
    ).toBe(false);

    expect(
      shouldExcludeFromDefaultFileTracking({
        path: 'venv/lib/pkg.py',
        action: 'Create',
        stage: 'staged',
      }),
    ).toBe(false);
    expect(
      shouldExcludeFromDefaultFileTracking({ path: 'venv/lib/pkg.py', action: 'Modify' }),
    ).toBe(false);
    expect(
      shouldExcludeFromDefaultFileTracking({ path: 'venv/lib/pkg.py', action: 'Delete' }),
    ).toBe(false);
    expect(
      shouldExcludeFromDefaultFileTracking({ path: 'src/venv_utils.ts', action: 'Create' }),
    ).toBe(false);
  });

  it('partitions excluded candidates and summarizes with small samples', () => {
    const items = [
      { path: 'venv/a.py', action: 'Create' },
      { path: '.venv/b.py', action: 'Create' },
      { path: 'node_modules/c.js', action: 'Create' },
      { path: 'google-cloud-sdk/platform/gsutil/d.py', action: 'Create' },
      { path: '__pycache__/d.pyc', action: 'Create' },
      { path: '.pytest_cache/e', action: 'Create' },
      { path: '.mypy_cache/f', action: 'Create' },
      { path: 'src/venv_utils.ts', action: 'Create' },
    ];

    const { kept, skipped } = partitionDefaultFileTrackingExcludes(items, (item) => item);
    const summary = summarizeDefaultFileTrackingExcludes(skipped.map((item) => item.path));

    expect(kept.map((item) => item.path)).toEqual(['src/venv_utils.ts']);
    expect(skipped).toHaveLength(7);
    expect(summary.skippedCount).toBe(7);
    expect(summary.skippedSample).toHaveLength(5);
  });
});
