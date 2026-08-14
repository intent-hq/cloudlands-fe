import { describe, expect, it } from 'vitest';
import type { AgentSession, Note } from '$shared/types';
import { deriveAgentLauncherItems, deriveNoteLauncherItems } from './sidebar-launcher-preview';

function agent(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    name: id,
    messages: [],
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    lastActivity: '2026-08-14T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

describe('sidebar launcher primary ordering', () => {
  it('keeps the marked initial coordinator first even when another agent is running', () => {
    const state = deriveAgentLauncherItems(
      [agent('worker'), agent('coordinator', { isInitialAgent: true })],
      6,
      ({ id }) => id === 'worker',
      () => ({ lastUserMessage: '', response: '' }),
    );

    expect(state.launcherAgents.map(({ agent: item }) => item.id)).toEqual([
      'coordinator',
      'worker',
    ]);
  });

  it('keeps the Spec note first without changing the remaining root-note order', () => {
    const notes = [
      { id: 'context', title: 'Context' },
      { id: 'spec', title: 'Spec' },
      { id: 'notes', title: 'Notes' },
    ] as Note[];

    expect(deriveNoteLauncherItems(notes, 6, () => true).launcherNotes.map(({ id }) => id)).toEqual(
      ['spec', 'context', 'notes'],
    );
  });
});
