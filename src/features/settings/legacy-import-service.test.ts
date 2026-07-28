import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  legacyImportFailed,
  legacyImportRequested,
  legacyImportSucceeded,
} from '$store/renderer/slices/legacy-import/legacy-import-slice';
import { loadWorkspacesRequested } from '$store/renderer/slices/workspace/workspace-slice';
import type { LegacyImportReport } from '$store/renderer/slices/legacy-import/legacy-import-types';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  importLegacyWorkspaces: vi.fn(),
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch },
}));

vi.mock('./legacy-import.client', () => ({
  importLegacyWorkspaces: mocks.importLegacyWorkspaces,
}));

import { createLegacyImportMiddleware } from './legacy-import-service';

const report: LegacyImportReport = {
  imported: 2,
  updated: 1,
  skipped: 3,
  notes: 4,
  comments: 5,
  agents: 6,
  assets: 7,
  skipSummary: [],
  compatibilityFailures: false,
  markerWritten: true,
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function dispatchThroughMiddleware(action: ReturnType<typeof legacyImportRequested>) {
  const next = vi.fn((value) => value);
  createLegacyImportMiddleware()({} as never)(next)(action);
  return next;
}

describe('legacyImportService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('imports with the requested force value and refreshes workspaces', async () => {
    mocks.importLegacyWorkspaces.mockResolvedValue(report);

    const action = legacyImportRequested(true);
    const next = dispatchThroughMiddleware(action);
    await flush();

    expect(next).toHaveBeenCalledWith(action);
    expect(mocks.importLegacyWorkspaces).toHaveBeenCalledWith(true);
    expect(mocks.dispatch).toHaveBeenNthCalledWith(1, legacyImportSucceeded(report));
    expect(mocks.dispatch).toHaveBeenNthCalledWith(2, loadWorkspacesRequested());
  });

  it('dispatches a failure and does not refresh workspaces', async () => {
    mocks.importLegacyWorkspaces.mockRejectedValue(new Error('Local connection required'));

    dispatchThroughMiddleware(legacyImportRequested(false));
    await flush();

    expect(mocks.importLegacyWorkspaces).toHaveBeenCalledWith(false);
    expect(mocks.dispatch).toHaveBeenCalledWith(legacyImportFailed('Local connection required'));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(loadWorkspacesRequested());
  });
});