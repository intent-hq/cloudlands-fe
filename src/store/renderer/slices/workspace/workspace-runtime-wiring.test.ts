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

describe('workspace recency runtime wiring', () => {
  it('stores recency tracking in the Redux workspace slice', () => {
    expect(WORKSPACE_SLICE_SOURCE).toContain('export const recordWorkspaceView');
    expect(WORKSPACE_SLICE_SOURCE).toContain('export const cleanupRecency');
    expect(WORKSPACE_SLICE_SOURCE).toContain('.with(recordWorkspaceView');
    expect(WORKSPACE_SLICE_SOURCE).toContain('.with(cleanupRecency');
  });

});