import { describe, expect, it } from 'vitest';
import type { WorkspaceEvent } from '$features/events/types';
import type { PresenceIdentity } from '$store/renderer/slices/presence/presence-types';
import { getPeopleActivity } from './people-activity';

const workspaceId = 'workspace-1';
const person: PresenceIdentity = {
  principalId: 'principal-1',
  displayName: 'Current name',
  login: 'current-login',
  avatarUrl: 'https://example.com/avatar.png',
};
function event(overrides: Partial<WorkspaceEvent> = {}): WorkspaceEvent {
  return {
    id: 'event-1',
    workspaceId,
    timestamp: '2026-10-14T12:00:00Z',
    type: 'note:updated',
    actor: { type: 'user', id: 'principal-1', name: 'Historical name' },
    data: { noteId: 'note-1', title: 'Design plan' },
    ...overrides,
  };
}
function rows(events: WorkspaceEvent[], people: PresenceIdentity[] = [person]) {
  return getPeopleActivity(workspaceId, events, people);
}

describe('People activity', () => {
  it.each([
    ['note:updated', { noteId: 'note-1', title: 'Plan' }, { type: 'note', noteId: 'note-1' }],
    ['comment:added', { noteId: 'note-2' }, { type: 'note', noteId: 'note-2' }],
    ['comment:resolved', { noteId: 'note-2', resolved: true }, { type: 'note', noteId: 'note-2' }],
    ['task:status-changed', { linkedNoteId: 'task-1' }, { type: 'note', noteId: 'task-1' }],
    ['spec:updated', {}, { type: 'note', noteId: 'spec' }],
    ['goal:updated', {}, { type: 'note', noteId: 'spec' }],
    ['agent:created', { agentId: 'agent-1' }, { type: 'agent', agentId: 'agent-1' }],
    [
      'agent:message',
      { agentId: 'agent-2', role: 'user', author: person },
      { type: 'agent', agentId: 'agent-2' },
    ],
    [
      'file:changed',
      { path: 'src/app.ts', action: 'modify' },
      { type: 'file', filePath: 'src/app.ts' },
    ],
    ['git:commit', { commit: 'abc123' }, { type: 'changes', data: { commitHash: 'abc123' } }],
    [
      'git:commit',
      { commit: 'def456', gitRootId: 'frontend-root' },
      { type: 'changes', data: { commitHash: 'def456', gitRootId: 'frontend-root' } },
    ],
  ])('resolves the recorded subject for %s', (type, data, destination) => {
    expect(
      rows([event({ type: type as WorkspaceEvent['type'], data })])[0].destination,
    ).toMatchObject({
      workspaceId,
      closable: true,
      ...destination,
    });
  });

  it('uses the recorded agent session when the payload has no agent ID', () => {
    expect(
      rows([event({ type: 'agent:created', sessionId: 'session-agent', data: {} })])[0].destination,
    ).toMatchObject({ type: 'agent', agentId: 'session-agent' });
  });

  it.each([
    ['agent:created', {}],
    ['note:updated', { noteId: { malformed: true } }],
    ['comment:added', {}],
    ['agent:deleted', { agentId: 'deleted-agent' }],
    ['note:deleted', { noteId: 'deleted-note' }],
    ['file:changed', { path: 'src/gone.ts', action: 'delete' }],
  ])('does not invent a destination for unavailable %s subjects', (type, data) => {
    expect(rows([event({ type: type as WorkspaceEvent['type'], data })])[0].destination).toBeNull();
  });

  it('shows recorded human message authors and photos, including system-delivered messages', () => {
    const message = event({
      type: 'agent:message',
      actor: { type: 'system', name: 'System' },
      data: {
        role: 'user',
        messageId: 'message-1',
        agentId: 'agent-1',
        author: person,
      },
    });
    expect(rows([message], [])).toEqual([
      expect.objectContaining({
        name: person.displayName,
        avatarUrl: person.avatarUrl,
        label: 'Current name: Sent a message',
      }),
    ]);
    expect(rows([message, { ...message, id: 'replayed-event' }])).toHaveLength(1);
  });

  it('keeps portable message authors self-contained and never borrows the current profile', () => {
    expect(
      rows([
        event({
          type: 'agent:message',
          data: {
            role: 'user',
            author: { ...person, principalId: null, displayName: 'Former member', avatarUrl: null },
          },
        }),
      ])[0],
    ).toMatchObject({ name: 'Former member', avatarUrl: null });
  });

  it('excludes automatic, assistant, malformed and unattributed message echoes', () => {
    const message = event({ type: 'agent:message', data: { role: 'user', author: person } });
    const rejected = [
      { role: 'assistant', author: person },
      { role: 'user' },
      { role: 'user', author: { displayName: 'Unresolved' } },
      { role: 'user', author: person, metadata: { source: 'system' } },
      { role: 'user', author: person, metadata: { fromAgentId: 'agent-1' } },
      { role: 'user', author: person, metadata: { type: 'hook_wake' } },
    ];
    expect(rows(rejected.map((data, i) => ({ ...message, id: `rejected-${i}`, data })))).toEqual(
      [],
    );
  });

  it('includes explicit model changes while excluding read-marker updates', () => {
    expect(rows([event({ type: 'agent:updated', data: { lastSeenMessageId: 'read-1' } })])).toEqual(
      [],
    );
    expect(rows([event({ type: 'agent:updated', data: { modelId: 'model-1' } })])[0].label).toBe(
      'Historical name: Agent model set to model-1',
    );
  });

  it('keeps historical names and gets photos only from the same principal', () => {
    expect(rows([event()])).toEqual([
      expect.objectContaining({
        name: 'Historical name',
        label: 'Historical name updated "Design plan"',
        avatarUrl: person.avatarUrl,
      }),
    ]);
    expect(rows([event()], [])[0]).toMatchObject({
      name: 'Historical name',
      avatarUrl: null,
    });
    expect(
      rows([event()], [{ ...person, principalId: 'different', displayName: 'Historical name' }])[0]
        .avatarUrl,
    ).toBeNull();
  });

  it('resolves an unnamed actor by principal ID, never by current user or name', () => {
    expect(rows([event({ actor: { type: 'user', id: person.principalId } })])[0].name).toBe(
      'Current name',
    );
    expect(
      rows([
        event({ actor: { type: 'user', id: person.principalId, name: person.principalId } }),
      ])[0].name,
    ).toBe('Current name');
    expect(rows([event({ actor: { type: 'user', id: 'removed' } })])).toEqual([]);
    expect(rows([event({ actor: { type: 'user' } })])).toEqual([]);
    expect(
      rows([event({ actor: { type: 'user', name: 'Historical name' } })])[0].avatarUrl,
    ).toBeNull();
  });

  it.each(['User', 'System', 'You', 'Unknown', 'Anonymous', '  '])(
    'does not present legacy placeholder %j as a person',
    (name) => {
      expect(rows([event({ actor: { type: 'user', name } })])).toEqual([]);
    },
  );

  it.each(['agent', 'system', 'external', 'tool'] as const)(
    'does not attribute %s events to a roster member',
    (type) => {
      expect(
        rows([event({ actor: { type, id: person.principalId, name: 'Historical name' } })]),
      ).toEqual([]);
    },
  );

  it('includes comments, without trusting author fields or inventing a note title', () => {
    expect(
      rows([
        event({ type: 'comment:added', data: { noteId: 'note-1', author: 'Someone else' } }),
      ])[0].label,
    ).toBe('Historical name commented');
    expect(
      rows([
        event({
          type: 'comment:added',
          actor: { type: 'system' },
          data: { author: 'Historical name' },
        }),
      ]),
    ).toEqual([]);
  });

  it('names the human who sent a message instead of calling every sender you', () => {
    expect(
      rows([event({ type: 'agent:user-message:sent', data: { agentName: 'Planner' } })])[0].label,
    ).toBe('Historical name: Sent a message to Planner');
    expect(rows([event({ type: 'agent:user-message:sent', data: {} })])[0].label).toBe(
      'Historical name: Sent a message',
    );
    expect(
      rows([event({ type: 'agent:message', data: { authorPrincipalId: person.principalId } })]),
    ).toEqual([]);
  });

  it('keeps the actor separate from the agent they changed', () => {
    expect(rows([event({ type: 'agent:deleted', data: { agentName: 'Planner' } })])[0].label).toBe(
      'Historical name: Deleted Planner',
    );
  });

  it('excludes unknown events, lifecycle noise, status-only updates and generated files', () => {
    const hidden = [
      event({ type: 'future:action' as WorkspaceEvent['type'] }),
      event({ type: 'agent:status-changed', data: { status: 'responding' } }),
      event({
        type: 'workspace:updated',
        data: { changes: { statusMessage: 'Working', lastActivity: 'now' } },
      }),
      event({ type: 'file:changed', data: { path: '.git/index', action: 'modify' } }),
    ];
    expect(rows(hidden)).toEqual([]);
    expect(
      rows([event({ type: 'file:changed', data: { path: 'src/app.ts', action: 'modify' } })])[0]
        .label,
    ).toBe('Historical name updated app.ts');
  });

  it('uses a generic workspace label for member changes without claiming an invitation', () => {
    expect(
      rows([
        event({
          type: 'workspace:updated',
          data: { changes: { members: true, addedPrincipalId: 'principal-2' } },
        }),
      ])[0].label,
    ).toBe('Historical name: Updated workspace');
  });

  it('sorts newest first, deduplicates event IDs and keeps repeated distinct actions', () => {
    const recent = event({ id: 'recent', timestamp: '2026-10-14T13:00:00Z' });
    const older = event({ id: 'older', timestamp: '2026-10-14T11:00:00Z' });
    const history = [older, event(), recent, recent];
    expect(rows(history).map((row) => row.id)).toEqual(['recent', 'event-1', 'older']);
    expect(history[0]).toBe(older);
  });

  it('ignores other workspaces and invalid timestamps before deduplicating', () => {
    expect(
      rows([
        event({ workspaceId: 'other-workspace' }),
        event({ timestamp: 'invalid' }),
        event(),
      ]).map((row) => row.id),
    ).toEqual(['event-1']);
  });

  it('never leaks raw event names when known events carry malformed optional fields', () => {
    expect(rows([event({ data: { title: { broken: true } } })])[0].label).toBe(
      'Historical name updated "note"',
    );
    expect(rows([event({ type: 'agent:deleted', data: { agentName: ['broken'] } })])[0].label).toBe(
      'Historical name: Agent deleted',
    );
  });
});
