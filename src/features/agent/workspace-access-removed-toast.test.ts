import { describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { warmImport } from '../../test/warm-import';

const info = vi.hoisted(() => vi.fn());
vi.mock('$lib/components/patterns/notify', () => ({ notify: { info } }));
warmImport(() => import('./agent-attention-toast-service'));

describe('showWorkspaceAccessRemovedToast', () => {
  it('names a self-initiated leave as leaving and an owner removal as a removal', async () => {
    const { showWorkspaceAccessRemovedToast } = await import('./agent-attention-toast-service');
    const notice = { workspaceId: 'ws-1', title: 'Shared project', hostLabel: 'studio.local' };

    await showWorkspaceAccessRemovedToast({ ...notice, selfInitiated: true });
    await showWorkspaceAccessRemovedToast(notice);

    const params = { title: 'Shared project', host: 'studio.local' };
    expect(info.mock.calls.map(([text]) => text)).toEqual([
      m.guestSessions_leftWorkspace_toast(params),
      m.guestSessions_accessRemoved_toast(params),
    ]);
    expect(info.mock.calls[0]![0]).toBe('You left Shared project on studio.local.');
  });
});
