import { describe, expect, it, vi } from 'vitest';

const { sendToWorkspaceWindows } = vi.hoisted(() => ({ sendToWorkspaceWindows: vi.fn() }));

vi.mock('$features/system/main/system.ipc', () => ({ sendToWorkspaceWindows }));

import { publishMainDomainEvent } from '../main-domain-event-publisher';

describe('publishMainDomainEvent', () => {
  it('publishes the exact domain payload only to the owning workspace', () => {
    const payload = { workspaceId: 'ws-1', sourceId: 'source-1' } as any;

    publishMainDomainEvent('ws-1', 'source:deleted', payload);

    expect(sendToWorkspaceWindows).toHaveBeenCalledWith('ws-1', 'source:deleted', payload);
  });
});
