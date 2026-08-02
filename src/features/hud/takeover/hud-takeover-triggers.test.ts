import { describe, expect, it } from 'vitest';
import type { WorkspaceEvent } from '$features/events/types';
import { HUD_FEED_EVENT_TYPES } from '../hud-feed-mapper';
import {
  HUD_TAKEOVER_EVENT_TYPES,
  HUD_TAKEOVER_TRIGGER_KINDS,
  mapEventToTakeoverTrigger,
} from './hud-takeover-triggers';

const TS = '2026-07-30T12:00:00.000Z';
const TS_MS = Date.parse(TS);
const AGENT_UUID = 'agent-579724c1-fe68-450e-8188-43b7afb964c6';

function event(type: string, data: Record<string, unknown> = {}): WorkspaceEvent {
  return {
    id: 'evt-1',
    type,
    workspaceId: 'ws-1',
    timestamp: TS,
    data,
  } as unknown as WorkspaceEvent;
}

/** PROTOCOL §7.1-shaped question resource block (compact JSON in `text`). */
function questionBlock(question: string, header = 'Auth method') {
  return {
    type: 'resource',
    resource: {
      uri: 'intent-question://tar-3f9c2a81d0b4',
      name: header,
      mimeType: 'application/vnd.intent.question+json',
      text: JSON.stringify({
        attachmentId: 'tar-3f9c2a81d0b4',
        header,
        question,
        options: [{ label: 'OAuth' }, { label: 'API key' }],
        multiSelect: false,
      }),
    },
  };
}

describe('hud-takeover-triggers', () => {
  it('every takeover event type except the takeover-only families is also a feed type', () => {
    const takeoverOnly = ['agent:stream:end', 'workspace:updated'];
    for (const type of HUD_TAKEOVER_EVENT_TYPES) {
      if (takeoverOnly.includes(type)) continue;
      expect(HUD_FEED_EVENT_TYPES as readonly string[]).toContain(type);
    }
    // agent:stream:end (§7.1 question trailingBlocks) and workspace:updated
    // (statusMessage delta) are takeover-only: they never render in the feed.
    for (const type of takeoverOnly) {
      expect(HUD_FEED_EVENT_TYPES as readonly string[]).not.toContain(type);
    }
  });

  it('maps task completion with title and changed task id', () => {
    const trigger = mapEventToTakeoverTrigger(
      event('task:status-changed', { noteId: 'n-1', noteTitle: 'Ship it', newStatus: 'complete' }),
    );
    expect(trigger).toEqual({
      workspaceId: 'ws-1',
      kind: 'task_complete',
      detail: 'Ship it',
      raisedAtMs: TS_MS,
      changedTaskId: 'n-1',
    });
  });

  it('ignores non-complete task transitions', () => {
    expect(
      mapEventToTakeoverTrigger(
        event('task:status-changed', { noteId: 'n-1', newStatus: 'in_progress' }),
      ),
    ).toBeNull();
  });

  it('maps agent created/started/failed', () => {
    expect(
      mapEventToTakeoverTrigger(event('agent:created', { agentName: 'Verifier' })),
    ).toMatchObject({ kind: 'agent_delegated', detail: 'Verifier' });
    expect(
      mapEventToTakeoverTrigger(
        event('agent:failed', { agentName: 'Verifier', error: 'sha mismatch' }),
      ),
    ).toMatchObject({ kind: 'agent_failed', detail: 'Verifier: sha mismatch' });
  });

  it("reads agent:created's `name` field (agent_ops emits { agentId, name })", () => {
    expect(
      mapEventToTakeoverTrigger(event('agent:created', { agentId: AGENT_UUID, name: 'Verifier' })),
    ).toMatchObject({ kind: 'agent_delegated', detail: 'Verifier' });
  });

  it('never renders a raw agent UUID: resolves via the resolver or omits', () => {
    const resolver = (agentId: string) => (agentId === AGENT_UUID ? 'Implementor' : undefined);
    // No name on the payload → resolver supplies it.
    expect(
      mapEventToTakeoverTrigger(event('agent:started', { agentId: AGENT_UUID }), resolver),
    ).toMatchObject({ kind: 'agent_started', detail: 'Implementor' });
    // UUID-shaped agentName on the payload → resolver still wins.
    expect(
      mapEventToTakeoverTrigger(
        event('agent:started', { agentId: AGENT_UUID, agentName: AGENT_UUID }),
        resolver,
      ),
    ).toMatchObject({ detail: 'Implementor' });
    // Unresolvable → the name is omitted, never the raw id.
    expect(
      mapEventToTakeoverTrigger(event('agent:started', { agentId: AGENT_UUID })),
    ).toMatchObject({ detail: '' });
    expect(
      mapEventToTakeoverTrigger(
        event('agent:failed', { agentId: AGENT_UUID, error: 'sha mismatch' }),
      ),
    ).toMatchObject({ kind: 'agent_failed', detail: 'sha mismatch' });
  });

  it('maps a raised attention flag and ignores clears', () => {
    expect(
      mapEventToTakeoverTrigger(
        event('workspace:attention-changed', { attention: 'review_required' }),
      ),
    ).toMatchObject({ kind: 'question_asked', detail: 'review_required' });
    expect(
      mapEventToTakeoverTrigger(event('workspace:attention-changed', { attention: 'none' })),
    ).toBeNull();
  });

  it('maps a workspace:updated statusMessage change and nothing else', () => {
    expect(
      mapEventToTakeoverTrigger(
        event('workspace:updated', {
          changes: { statusMessage: 'Implementing the toggle; 8 tasks to go.' },
        }),
      ),
    ).toMatchObject({ kind: 'status_update', detail: 'Implementing the toggle; 8 tasks to go.' });
    // Cleared/empty message → no takeover.
    expect(
      mapEventToTakeoverTrigger(event('workspace:updated', { changes: { statusMessage: '' } })),
    ).toBeNull();
    // Other workspace:updated deltas (no statusMessage key) → no takeover.
    expect(
      mapEventToTakeoverTrigger(event('workspace:updated', { changes: { title: 'Renamed' } })),
    ).toBeNull();
    expect(mapEventToTakeoverTrigger(event('workspace:updated'))).toBeNull();
  });

  it('does NOT fire a status_update on displayStatus transitions', () => {
    expect(
      mapEventToTakeoverTrigger(
        event('workspace:displayStatus-changed', { displayStatus: 'in_progress' }),
      ),
    ).toBeNull();
    expect(
      mapEventToTakeoverTrigger(
        event('workspace:displayStatus-changed', { displayStatus: 'pr_open' }),
      ),
    ).toBeNull();
  });

  it('surfaces the §7.1 question text from agent:stream:end trailingBlocks', () => {
    const trigger = mapEventToTakeoverTrigger(
      event('agent:stream:end', {
        agentId: AGENT_UUID,
        messageId: 'msg-1',
        trailingBlocks: [questionBlock('Which authentication method should the endpoint use?')],
      }),
    );
    expect(trigger).toMatchObject({
      kind: 'question_asked',
      detail: 'Which authentication method should the endpoint use?',
    });
  });

  it('ignores agent:stream:end without question trailingBlocks', () => {
    expect(
      mapEventToTakeoverTrigger(event('agent:stream:end', { agentId: AGENT_UUID })),
    ).toBeNull();
    expect(
      mapEventToTakeoverTrigger(
        event('agent:stream:end', {
          agentId: AGENT_UUID,
          messageId: 'msg-1',
          trailingBlocks: [{ type: 'text', text: 'not a question' }],
        }),
      ),
    ).toBeNull();
  });

  it('returns null for non-trigger families and missing workspace id', () => {
    expect(mapEventToTakeoverTrigger(event('git:commit', { message: 'x' }))).toBeNull();
    expect(mapEventToTakeoverTrigger(event('agent:completed'))).toBeNull();
    const noWs = { ...event('agent:failed'), workspaceId: undefined } as unknown as WorkspaceEvent;
    expect(mapEventToTakeoverTrigger(noWs)).toBeNull();
  });

  it('falls back to the arrival clock on a missing timestamp', () => {
    const noTs = { ...event('agent:started', { agentId: 'a' }), timestamp: undefined };
    const before = Date.now();
    const trigger = mapEventToTakeoverTrigger(noTs as unknown as WorkspaceEvent);
    expect(trigger!.raisedAtMs).toBeGreaterThanOrEqual(before);
  });

  it('trigger-kind const covers exactly the documented notable events', () => {
    expect(Object.keys(HUD_TAKEOVER_TRIGGER_KINDS).sort()).toEqual(
      [
        'agent:created',
        'agent:failed',
        'agent:started',
        'agent:stream:end',
        'task:status-changed',
        'workspace:attention-changed',
        'workspace:updated',
      ].sort(),
    );
  });
});
