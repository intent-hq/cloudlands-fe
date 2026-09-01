import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { importLegacyWorkspaces, type LegacyImportReport } from './legacy-import.client';

describe('importLegacyWorkspaces', () => {
  const report: LegacyImportReport = {
    imported: 2,
    updated: 1,
    skipped: 3,
    notes: 4,
    comments: 5,
    agents: 6,
    assets: 7,
    skipSummary: [{ id: 'existing', reason: 'already exists' }],
    compatibilityFailures: false,
    markerWritten: true,
  };
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    vi.stubGlobal('window', {
      electronAPI: { invoke, on: vi.fn(), offById: vi.fn() },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the default non-overwriting request and returns the report', async () => {
    invoke.mockResolvedValue({ ok: true, result: report });

    await expect(importLegacyWorkspaces()).resolves.toEqual(report);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REQUEST, {
      method: 'system.importLegacy',
      params: { force: false },
    });
  });

  it('maps overwrite to force=true', async () => {
    invoke.mockResolvedValue({ ok: true, result: report });

    await importLegacyWorkspaces(true);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REQUEST, {
      method: 'system.importLegacy',
      params: { force: true },
    });
  });
});