import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { openTerminalOverlay } from '$store/renderer/slices/terminals/terminals-slice';

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceActionContext: { select: () => 'admitted' },
}));

const dispatch = vi.hoisted(() => vi.fn());
const mockState = vi.hoisted(() => ({ scripts: { byWorkspaceId: {} as Record<string, any> } }));
vi.mock('$lib/components/patterns/confirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: vi.fn() } }));

vi.mock('$lib/components/terminal/Terminal.svelte', async () => ({
  default: (await import('./mocks/MockTerminal.svelte')).default,
}));
vi.mock('$lib/components/terminal/ScriptOutputViewer.svelte', async () => ({
  default: (await import('./mocks/MockTerminal.svelte')).default,
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch, state: mockState });
});

import { scriptsClient } from '$features/scripts/scripts.client';
import { appClient } from '$lib/client';

vi.mock('$lib/client', () => ({
  appClient: { scripts: { list: vi.fn(), create: vi.fn() } },
}));
import { scriptsReducer } from '$store/renderer/slices/scripts/scripts-slice';
import { confirm } from '$lib/components/patterns/confirm';
import { store } from '$store/renderer/store';
import TerminalTabTypeHeaderHarness from './mocks/TerminalTabTypeHeaderHarness.svelte';

const action = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-move-to-bottom-bar]');

describe('TerminalTabType header action lifecycle', () => {
  beforeEach(() => dispatch.mockClear());
  afterEach(cleanup);

  it('clears the terminal action when a cached browser tab becomes active', async () => {
    const view = render(TerminalTabTypeHeaderHarness, {
      props: { activeTabId: 'terminal-tab-1' },
    });
    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    await waitFor(() => expect(action(view.container)).not.toBeNull());

    await view.rerender({ activeTabId: 'browser-tab' });

    await waitFor(() => expect(action(view.container)).toBeNull());
  });

  it.each([
    ['terminal-tab-1', 'terminal-tab-2', 'terminal-session-2'],
    ['terminal-tab-2', 'terminal-tab-1', 'terminal-session-1'],
  ])('reassigns the action from %s to %s', async (from, to, terminalId) => {
    const view = render(TerminalTabTypeHeaderHarness, { props: { activeTabId: from } });
    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    await waitFor(() => expect(action(view.container)).not.toBeNull());

    await view.rerender({ activeTabId: to });
    await waitFor(() => expect(action(view.container)).not.toBeNull());
    dispatch.mockClear();
    await fireEvent.click(action(view.container)!);

    expect(dispatch).toHaveBeenCalledWith(openTerminalOverlay('workspace-1', terminalId));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: closeTab.type,
        payload: expect.objectContaining({ wsId: 'layout-1', tabId: to }),
      }),
    );
  });

  it('clears an active terminal registration when that tab unmounts', async () => {
    const view = render(TerminalTabTypeHeaderHarness, {
      props: { activeTabId: 'terminal-tab-1' },
    });
    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    await waitFor(() => expect(action(view.container)).not.toBeNull());

    await view.rerender({ activeTabId: 'terminal-tab-1', firstMounted: false });

    await waitFor(() => expect(action(view.container)).toBeNull());
  });
});

describe('script panel deletion', () => {
  beforeEach(() => {
    dispatch.mockClear();
    vi.mocked(confirm).mockReset().mockResolvedValue(true);
    mockState.scripts.byWorkspaceId = {
      'workspace-1': {
        scripts: {
          check: {
            id: 'check',
            name: 'Project check',
            createdAt: '2026-10-09',
            runtime: { status: 'idle' },
          },
        },
        operations: {},
      },
    };
  });
  afterEach(cleanup);

  async function openMenu() {
    await fireEvent.click(screen.getByRole('button', { name: 'Panel actions' }));
  }

  it('confirms the named script and dispatches deletion from the panel menu', async () => {
    render(TerminalTabTypeHeaderHarness, { activeTabId: 'terminal-tab-1', scriptId: 'check' });
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete script' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('Project check') }),
    );
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scripts/deleteScriptRequested',
          payload: ['workspace-1', 'check', expect.any(String)],
        }),
      ),
    );
  });

  it.each([true, false])(
    'disables the panel menu during a direct save (success: %s)',
    async (success) => {
      dispatch.mockImplementation((action) => {
        mockState.scripts = scriptsReducer(mockState.scripts as never, action);
        (store as any).emitState();
      });
      let finish!: (value: { success: boolean }) => void;
      vi.mocked(appClient.scripts.list).mockResolvedValue([
        mockState.scripts.byWorkspaceId['workspace-1'].scripts.check,
      ]);
      vi.mocked(appClient.scripts.create).mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const pending = scriptsClient.update('workspace-1', 'check', { name: 'Renamed' });
      render(TerminalTabTypeHeaderHarness, { activeTabId: 'terminal-tab-1', scriptId: 'check' });
      await openMenu();
      expect(
        screen.getByRole('menuitem', { name: /Delete script/ }).getAttribute('aria-disabled'),
      ).toBe('true');
      await waitFor(() => expect(finish).toBeTypeOf('function'));
      finish({ success });
      await pending;
      await waitFor(() =>
        expect(
          screen.getByRole('menuitem', { name: /Delete script/ }).getAttribute('aria-disabled'),
        ).not.toBe('true'),
      );
      dispatch.mockReset();
    },
  );

  it('rejects deletion when a direct save starts after panel confirmation opens', async () => {
    dispatch.mockImplementation((action) => {
      mockState.scripts = scriptsReducer(mockState.scripts as never, action);
      (store as any).emitState();
    });
    let accept!: (value: boolean) => void;
    vi.mocked(confirm).mockReturnValue(
      new Promise((resolve) => {
        accept = resolve;
      }),
    );
    render(TerminalTabTypeHeaderHarness, { activeTabId: 'terminal-tab-1', scriptId: 'check' });
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete script' }));
    let finish!: (value: { success: boolean }) => void;
    vi.mocked(appClient.scripts.list).mockResolvedValue([
      mockState.scripts.byWorkspaceId['workspace-1'].scripts.check,
    ]);
    vi.mocked(appClient.scripts.create).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = scriptsClient.update('workspace-1', 'check', { name: 'Renamed' });
    accept(true);
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scripts/deleteScriptRequested' }),
    );
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    finish({ success: true });
    await pending;
    dispatch.mockReset();
  });

  it('cancels without a deletion request', async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    render(TerminalTabTypeHeaderHarness, { activeTabId: 'terminal-tab-1', scriptId: 'check' });
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete script' }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps deletion out of ordinary terminal menus', async () => {
    render(TerminalTabTypeHeaderHarness, { activeTabId: 'terminal-tab-1' });
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Delete script' })).toBeNull();
  });

  it.each(['running', 'starting', 'restarting', 'unknown', undefined])(
    'disables panel deletion for %s',
    async (status) => {
      mockState.scripts.byWorkspaceId['workspace-1'].scripts.check.runtime.status = status;
      render(TerminalTabTypeHeaderHarness, { activeTabId: 'terminal-tab-1', scriptId: 'check' });
      await openMenu();
      expect(
        screen.getByRole('menuitem', { name: /Delete script/ }).getAttribute('aria-disabled'),
      ).toBe('true');
    },
  );

  it.each(['runtime', 'pending', 'workspace', 'script', 'tab'])(
    'rejects stale panel confirmation after %s changes',
    async (change) => {
      let accept!: (value: boolean) => void;
      vi.mocked(confirm).mockReturnValue(
        new Promise((resolve) => {
          accept = resolve;
        }),
      );
      const view = render(TerminalTabTypeHeaderHarness, {
        activeTabId: 'terminal-tab-1',
        scriptId: 'check',
      });
      await openMenu();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete script' }));
      if (change === 'runtime')
        mockState.scripts.byWorkspaceId['workspace-1'].scripts.check.runtime.status = 'running';
      if (change === 'pending')
        mockState.scripts.byWorkspaceId['workspace-1'].operations.check = {
          action: 'start',
          pending: true,
        };
      if (change === 'workspace') await view.rerender({ workspaceId: 'workspace-2' });
      if (change === 'script') await view.rerender({ scriptId: 'other' });
      if (change === 'tab') await view.rerender({ activeTabId: 'terminal-tab-2' });
      (store as any).emitState();
      accept(true);
      await Promise.resolve();
      expect(dispatch).not.toHaveBeenCalled();
    },
  );
});
