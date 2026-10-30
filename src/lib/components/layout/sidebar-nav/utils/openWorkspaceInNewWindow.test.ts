import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  openAndShowWorkspace: vi.fn(async (_workspaceId: string) => true),
}));

vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/utils/show-workspace', () => ({
  openAndShowWorkspace: mocks.openAndShowWorkspace,
}));

import { openWorkspaceInNewWindow } from './openWorkspaceInNewWindow';

describe('openWorkspaceInNewWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('opens a new window and leaves this window alone', async () => {
    mocks.invoke.mockResolvedValue({ success: true });

    await openWorkspaceInNewWindow('ws-1');

    expect(mocks.invoke).toHaveBeenCalledWith(expect.any(String), { route: '/workspace/ws-1' });
    expect(mocks.openAndShowWorkspace).not.toHaveBeenCalled();
  });

  it('falls back to showing the workspace, with its tab, when the window fails to open', async () => {
    mocks.invoke.mockResolvedValue({ success: false, error: 'no window' });

    await openWorkspaceInNewWindow('ws-1');

    expect(mocks.openAndShowWorkspace).toHaveBeenCalledWith('ws-1');
  });

  it('falls back to showing the workspace when opening the window throws', async () => {
    mocks.invoke.mockRejectedValue(new Error('ipc down'));

    await openWorkspaceInNewWindow('ws-1');

    expect(mocks.openAndShowWorkspace).toHaveBeenCalledWith('ws-1');
  });

  it('does not throw when the fallback navigation fails', async () => {
    mocks.invoke.mockRejectedValue(new Error('ipc down'));
    mocks.openAndShowWorkspace.mockRejectedValueOnce(new Error('goto stalled'));

    await expect(openWorkspaceInNewWindow('ws-1')).resolves.toBeUndefined();
  });
});
