/** @vitest-environment jsdom */
/**
 * The Development scripts empty state must follow a successful, empty read
 * (intent-hq/intent#7206): a pending or failed list read never claims that
 * the workspace has no scripts. Drives the real scripts slice with the same
 * actions the lifecycle read saga dispatches.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import {
  refreshScripts,
  setActiveScriptsData,
  setScriptListState,
  setScriptsInitialized,
} from '$store/renderer/slices/scripts/scripts-slice';
import { workspaceDeleted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import type { ScriptWithState } from '$store/renderer/slices/scripts/scripts-types';

vi.mock('svelte-fa', async () => ({
  default: (await import('../sidebar/__tests__/mocks/Fa.svelte')).default,
}));

import WorkspaceShellList from '../WorkspaceShellList.svelte';

const WS = 'ws-script-list-states';
const EMPTY = 'No scripts found. Add one manually or use AI detection.';
const LOADING = 'Loading scripts…';
const FAILED = "Couldn't load scripts.";

const saved: ScriptWithState = {
  id: 'gates',
  workspaceId: WS,
  name: 'Current main merged Rust gates',
  command: 'make check && make test',
  mode: 'command',
  source: 'user',
  createdAt: '2026-10-17T05:34:10.353Z',
  runtime: { status: 'running', restartCount: 0, runId: 'run-1' },
};

beforeAll(() => store.init());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // The scripts slice resets on workspaceDeleted; each test starts from an unread list.
  store.dispatch(workspaceDeleted(WS, []));
});

function mount() {
  render(WorkspaceShellList, { props: { workspaceId: WS } });
}

describe('WorkspaceShellList script list states', () => {
  it('shows loading, not "No scripts found", before any read, with a way to start one', async () => {
    const dispatch = vi.spyOn(store, 'dispatch');
    mount();
    expect(screen.getByText(LOADING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(dispatch).toHaveBeenCalledWith(refreshScripts(WS));
  });

  it('shows loading without Retry while a read is in flight', async () => {
    store.dispatch(setScriptListState(WS, true));
    mount();
    expect(await screen.findByText(LOADING)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows a failed read with its reason and a working Retry instead of the empty state', async () => {
    store.dispatch(setScriptListState(WS, false, 'Update the daemon and reconnect.'));
    const dispatch = vi.spyOn(store, 'dispatch');
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(FAILED);
    expect(alert.textContent).toContain('Update the daemon and reconnect.');
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(LOADING)).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(dispatch).toHaveBeenCalledWith(refreshScripts(WS));
  });

  it('keeps a forbidden read (settled empty with an error) from claiming no scripts', async () => {
    store.dispatch(setScriptListState(WS, false, 'Forbidden'));
    store.dispatch(setActiveScriptsData(WS, []));
    store.dispatch(setScriptsInitialized(WS, true));
    mount();
    expect((await screen.findByRole('alert')).textContent).toContain(FAILED);
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('claims no scripts only after a successful empty read', async () => {
    store.dispatch(setActiveScriptsData(WS, []));
    store.dispatch(setScriptListState(WS, false, undefined, true));
    store.dispatch(setScriptsInitialized(WS, true));
    mount();
    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('replaces the failure with the saved command once a retry succeeds, without remounting', async () => {
    store.dispatch(setScriptListState(WS, false, 'offline'));
    mount();
    await screen.findByRole('alert');
    store.dispatch(setScriptListState(WS, true));
    expect(await screen.findByText(LOADING)).toBeTruthy();
    store.dispatch(setActiveScriptsData(WS, [saved]));
    store.dispatch(setScriptListState(WS, false, undefined, true));
    store.dispatch(setScriptsInitialized(WS, true));
    expect(await screen.findByText(saved.name)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(LOADING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });
});
