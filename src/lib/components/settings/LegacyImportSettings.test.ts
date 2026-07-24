/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { legacyImportRequested } from '$store/renderer/slices/legacy-import/legacy-import-slice';
import type { LegacyImportReport } from '$store/renderer/slices/legacy-import/legacy-import-types';
import LegacyImportSettings from './LegacyImportSettings.svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {
    loading: false,
    report: null as LegacyImportReport | null,
    error: null as string | null,
  },
  makeSelector:
    <T>(read: () => T) =>
    () => ({
      subscribe(run: (value: T) => void) {
        run(read());
        return () => {};
      },
    }),
}));

vi.mock('$store/renderer/slices/legacy-import/legacy-import-selectors', () => ({
  selectLegacyImportLoading: mocks.makeSelector(() => mocks.state.loading),
  selectLegacyImportReport: mocks.makeSelector(() => mocks.state.report),
  selectLegacyImportError: mocks.makeSelector(() => mocks.state.error),
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.loading = false;
    mocks.state.report = null;
    mocks.state.error = null;
  });
  afterEach(cleanup);

  it('dispatches a non-overwriting import request', async () => {
    render(LegacyImportSettings);

    await fireEvent.click(screen.getByRole('button', { name: 'Import legacy workspaces' }));

    expect(mocks.dispatch).toHaveBeenCalledWith(legacyImportRequested(false));
  });

  it('maps the overwrite control to force=true', async () => {
    render(LegacyImportSettings);

    await fireEvent.click(screen.getByRole('switch', { name: 'Overwrite existing workspaces' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Import legacy workspaces' }));

    expect(mocks.dispatch).toHaveBeenCalledWith(legacyImportRequested(true));
  });

  it('renders loading state from the slice', () => {
    mocks.state.loading = true;
    render(LegacyImportSettings);

    const button = screen.getByRole('button', { name: 'Importing…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('renders report state from the slice', () => {
    mocks.state.report = report;
    render(LegacyImportSettings);

    expect(screen.getByRole('status').textContent).toContain('2 imported');
  });

  it('renders error state from the slice', () => {
    mocks.state.error = 'Local connection required';
    render(LegacyImportSettings);

    expect(screen.getByRole('alert').textContent).toContain(
      'Import failed: Local connection required',
    );
  });
});
