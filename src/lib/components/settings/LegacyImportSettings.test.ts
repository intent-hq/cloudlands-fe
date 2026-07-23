/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWorkspacesRequested } from '$store/renderer/slices/workspace/workspace-slice';
import type { LegacyImportReport } from '$features/settings/legacy-import.client';
import LegacyImportSettings from './LegacyImportSettings.svelte';

const mocks = vi.hoisted(() => ({
  importLegacyWorkspaces: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock('$features/settings/legacy-import.client', () => ({
  importLegacyWorkspaces: mocks.importLegacyWorkspaces,
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch },
}));

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

describe('LegacyImportSettings', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('shows loading and report states, then refreshes workspaces', async () => {
    let resolveImport!: (value: LegacyImportReport) => void;
    mocks.importLegacyWorkspaces.mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );
    render(LegacyImportSettings);

    const button = screen.getByRole('button', {
      name: 'Import legacy workspaces',
    }) as HTMLButtonElement;
    await fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Importing…')).toBeTruthy();

    resolveImport(report);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('2 imported'));
    expect(mocks.dispatch).toHaveBeenCalledWith(loadWorkspacesRequested());
  });

  it('maps the overwrite control to force=true', async () => {
    mocks.importLegacyWorkspaces.mockResolvedValue(report);
    render(LegacyImportSettings);

    await fireEvent.click(screen.getByRole('switch', { name: 'Overwrite existing workspaces' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Import legacy workspaces' }));

    await waitFor(() => expect(mocks.importLegacyWorkspaces).toHaveBeenCalledWith(true));
  });

  it('surfaces RPC errors without refreshing workspaces', async () => {
    mocks.importLegacyWorkspaces.mockRejectedValue(new Error('Local connection required'));
    render(LegacyImportSettings);

    await fireEvent.click(screen.getByRole('button', { name: 'Import legacy workspaces' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Import failed: Local connection required',
      ),
    );
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
