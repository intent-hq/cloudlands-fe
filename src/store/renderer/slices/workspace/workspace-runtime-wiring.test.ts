import {
  describe,
  expect,
  it,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKSPACE_SLICE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/store/renderer/slices/workspace/workspace-slice.ts'),
  'utf8',
);

const WORKSPACE_SAGA_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/store/renderer/slices/workspace/sagas/workspace-saga.ts'),
  'utf8',
);

describe('workspace recency runtime wiring', () => {
  it('stores recency tracking in the Redux workspace slice', () => {
    expect(WORKSPACE_SLICE_SOURCE).toContain('export const recordWorkspaceView');
    expect(WORKSPACE_SLICE_SOURCE).toContain('export const cleanupRecency');
    expect(WORKSPACE_SLICE_SOURCE).toContain('.with(recordWorkspaceView');
    expect(WORKSPACE_SLICE_SOURCE).toContain('.with(cleanupRecency');
  });

  it('persists recency through the workspace saga on record and cleanup actions', () => {
    expect(WORKSPACE_SAGA_SOURCE).toContain('yield* call(setLocalStorageJSON, WORKSPACE_RECENCY_STORAGE_KEY, recency);');
    expect(WORKSPACE_SAGA_SOURCE).toContain(
      'yield* takeEvery([recordWorkspaceView, cleanupRecency], persistWorkspaceRecency);',
    );
  });

});