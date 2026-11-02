import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  closeTerminalOverlay,
  openTerminalOverlay,
  selectScript,
  setTerminalPlacement,
} from '$store/renderer/slices/terminals/terminals-slice';

const mocks = vi.hoisted(() => ({
  show: vi.fn<(workspaceId: string) => Promise<boolean>>(),
  dispatch: vi.fn(),
  openUserTab: vi.fn(),
  terminalState: { isOpen: false, selectedScriptId: null as string | null },
}));
vi.mock('$lib/utils/show-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/show-workspace')>()),
  openAndShowWorkspace: mocks.show,
}));
vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => ({ openUserTab: mocks.openUserTab }),
}));
vi.mock('$store/renderer/slices/terminals/terminals-selectors', () => ({
  selectWorkspaceTerminalState: { select: () => mocks.terminalState },
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

import { openMonitoredScript } from './open-monitored-script';

const terminalTab = {
  type: 'terminal',
  title: 'verify',
  scriptId: 'script-1',
  workspaceId: 'ws-1',
  closable: true,
};

describe('openMonitoredScript', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.terminalState = { isOpen: false, selectedScriptId: null };
    mocks.show.mockImplementation(async (workspaceId: string) => {
      window.history.replaceState({}, '', `/workspace/${workspaceId}`);
      return true;
    });
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  // Regression: from the Home preview (route `/`) both menu items changed the
  // workspace's hidden layout and appeared to do nothing.
  it.each(['pane', 'bottom'] as const)(
    'shows the workspace before opening the script (%s) from Home',
    async (placement) => {
      let shown = false;
      mocks.show.mockImplementationOnce(async (workspaceId: string) => {
        shown = true;
        window.history.replaceState({}, '', `/workspace/${workspaceId}`);
        return true;
      });
      mocks.dispatch.mockImplementation(() => expect(shown).toBe(true));
      mocks.openUserTab.mockImplementation(() => expect(shown).toBe(true));

      await expect(openMonitoredScript('ws-1', 'script-1', 'verify', placement)).resolves.toBe(
        true,
      );

      expect(mocks.show).toHaveBeenCalledWith('ws-1');
      if (placement === 'pane') expect(mocks.openUserTab).toHaveBeenCalledWith(terminalTab);
      else expect(mocks.dispatch).toHaveBeenCalledWith(openTerminalOverlay('ws-1'));
    },
  );

  it('shows the owning workspace when another workspace is on screen', async () => {
    window.history.replaceState({}, '', '/workspace/other');

    await openMonitoredScript('ws-1', 'script-1', 'verify', 'bottom');

    expect(mocks.show).toHaveBeenCalledWith('ws-1');
  });

  it('opens the script in a panel in place when its workspace is showing', async () => {
    window.history.replaceState({}, '', '/workspace/ws-1');
    mocks.terminalState = { isOpen: true, selectedScriptId: 'script-1' };

    await expect(openMonitoredScript('ws-1', 'script-1', 'verify', 'pane')).resolves.toBe(true);

    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.openUserTab).toHaveBeenCalledWith(terminalTab);
    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      setTerminalPlacement('ws-1', 'script-1', 'panel'),
      closeTerminalOverlay('ws-1'),
    ]);
  });

  it('opens the script in the bottom bar in place when its workspace is showing', async () => {
    window.history.replaceState({}, '', '/workspace/ws-1');

    await expect(openMonitoredScript('ws-1', 'script-1', 'verify', 'bottom')).resolves.toBe(true);

    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      selectScript('ws-1', 'script-1'),
      openTerminalOverlay('ws-1'),
    ]);
  });

  it('opens an Assistant script in place, since the Assistant has no workspace page', async () => {
    await expect(
      openMonitoredScript(CHIEF_WORKSPACE_ID, 'script-1', 'verify', 'bottom'),
    ).resolves.toBe(true);

    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.dispatch).toHaveBeenCalledWith(openTerminalOverlay(CHIEF_WORKSPACE_ID));
  });

  it.each([
    ['is overtaken or skipped', () => mocks.show.mockResolvedValueOnce(false)],
    ['fails', () => mocks.show.mockRejectedValueOnce(new Error('navigation failed'))],
  ])('opens nothing when the workspace navigation %s', async (_label, arrange) => {
    arrange();

    await expect(openMonitoredScript('ws-1', 'script-1', 'verify', 'pane')).resolves.toBe(false);

    expect(mocks.openUserTab).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
