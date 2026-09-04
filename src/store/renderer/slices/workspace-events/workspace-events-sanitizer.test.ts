import { describe, expect, it } from 'vitest';
import { sanitizeWorkspaceEvent } from './workspace-events-sanitizer';

describe('workspace event sanitizer', () => {
  it('drops cyclic nested event data and returns JSON-serializable output', () => {
    const cyclicData: any = { command: 'pnpm test' };
    cyclicData.self = cyclicData;
    cyclicData.values = [cyclicData, { message: 'ok' }];

    const event = {
      id: 'evt-cycle',
      workspaceId: 'ws-1',
      timestamp: '2026-03-25T00:00:00.000Z',
      type: 'file:changed',
      actor: { type: 'system' },
      data: cyclicData,
    };

    const sanitized = sanitizeWorkspaceEvent(event, 'ws-1');

    expect(sanitized).toMatchObject({
      id: 'evt-cycle',
      workspaceId: 'ws-1',
      data: { command: 'pnpm test', values: [{ message: 'ok' }] },
    });
    expect(() => JSON.stringify(sanitized)).not.toThrow();
  });

  it('preserves shared non-cyclic references across sibling event fields', () => {
    const sharedActorRecord = { message: 'same actor details', count: 2 };
    const event = {
      id: 'evt-shared-reference',
      workspaceId: 'ws-1',
      timestamp: '2026-03-25T00:00:00.000Z',
      type: 'agent:message',
      actor: { type: 'agent', metadata: sharedActorRecord },
      metadata: sharedActorRecord,
      data: sharedActorRecord,
      codeChange: { details: sharedActorRecord },
      provenance: { details: sharedActorRecord },
    };

    const sanitized = sanitizeWorkspaceEvent(event, 'ws-1');

    expect(sanitized?.actor.metadata).toEqual(sharedActorRecord);
    expect(sanitized?.metadata).toEqual(sharedActorRecord);
    expect(sanitized?.data).toEqual(sharedActorRecord);
    expect(sanitized?.codeChange).toEqual({ details: sharedActorRecord });
    expect(sanitized?.provenance).toEqual({ details: sharedActorRecord });
    expect(() => JSON.stringify(sanitized)).not.toThrow();
  });
});
