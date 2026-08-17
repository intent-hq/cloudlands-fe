import { describe, expect, it, vi } from 'vitest';

import { sendWorkspaceCommand, type WorkspaceCommandWindow } from '../menu-workspace-command';

const WORKSPACE_CHANNELS = [
  'menu:new-agent',
  'menu:new-note',
  'menu:new-terminal',
  'menu:new-browser',
  'menu:close-tab',
  'menu:reopen-closed-tab',
  'menu:select-previous-tab',
  'menu:select-next-tab',
  'menu:zoom-in',
  'menu:zoom-out',
  'menu:reset-zoom',
];

function createWindow(destroyed = false) {
  const send = vi.fn();
  const window: WorkspaceCommandWindow = {
    isDestroyed: () => destroyed,
    webContents: { send },
  };
  return { window, send };
}

describe('sendWorkspaceCommand', () => {
  it('emits every workspace menu channel with the exact workspace payload', () => {
    const { window, send } = createWindow();

    for (const channel of WORKSPACE_CHANNELS) {
      expect(sendWorkspaceCommand(window, channel, 'ws-2')).toBe(true);
    }

    expect(send.mock.calls).toEqual(
      WORKSPACE_CHANNELS.map((channel) => [channel, { workspaceId: 'ws-2' }]),
    );
  });

  it.each([undefined, null, '', 42, { workspaceId: 'ws-2' }])(
    'does not emit for invalid workspace context %j',
    (workspaceId) => {
      const { window, send } = createWindow();

      expect(sendWorkspaceCommand(window, 'menu:new-browser', workspaceId)).toBe(false);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('does not emit to a destroyed window', () => {
    const { window, send } = createWindow(true);

    expect(sendWorkspaceCommand(window, 'menu:zoom-in', 'ws-2')).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
