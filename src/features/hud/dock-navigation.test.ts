import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { openDockConversation, openDockMessageTarget } from './dock-navigation';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('$lib/electron-bridge', () => ({ invoke }));

describe('compact conversation full-window handoff', () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue({ success: true, windowId: 7, reused: true });
  });

  it('sends the exact workspace and agent without navigating the dock', async () => {
    await openDockConversation('workspace/one', 'agent-specific');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('window:open-new', {
      route: '/workspace/workspace%2Fone',
      reuseExistingWorkspace: true,
      agentId: 'agent-specific',
    });
  });

  it('opens the selected Assistant thread in the normal Assistant route', async () => {
    await openDockConversation(CHIEF_WORKSPACE_ID, 'chief-thread');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('window:open-new', {
      route: '/',
      reuseExistingWorkspace: true,
      agentId: 'chief-thread',
    });
  });

  it('hands a transcript file and line to a reusable normal workspace window', async () => {
    await openDockMessageTarget('workspace-one', undefined, {
      type: 'file',
      filePath: 'src/app.ts',
      line: 42,
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('window:open-new', {
      route: '/workspace/workspace-one',
      reuseExistingWorkspace: true,
      workspaceTarget: { type: 'file', filePath: 'src/app.ts', line: 42 },
    });
  });

  it('propagates a failed native handoff so the compact view can recover', async () => {
    invoke.mockResolvedValue({ success: false, error: 'Window unavailable' });
    await expect(openDockConversation('workspace-one', 'agent-one')).rejects.toThrow(
      'Window unavailable',
    );
  });
});
