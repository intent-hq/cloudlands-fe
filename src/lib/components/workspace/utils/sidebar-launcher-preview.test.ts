import { describe, expect, it } from 'vitest';
import type { AgentSession, Note } from '$shared/types';
import {
  deriveAgentLauncherItems,
  deriveNoteLauncherItems,
  getAgentLauncherPreview,
  getLauncherPreviewLimit,
} from './sidebar-launcher-preview';

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
  it('hides exact delivery notes from the launcher preview', () => {
    const note =
      '[SYSTEM NOTE] This message was queued at 2026-01-01T00:00:00Z and waited 8s before delivery.';
    const session = agent('queued', {
      messages: [
        {
          id: 'user-queued',
          role: 'user',
          contentBlocks: [{ type: 'text', text: `Visible prompt\n\n${note}` }],
        } as never,
      ],
    });

    expect(getAgentLauncherPreview(session).lastUserMessage).toBe('Visible prompt');
  });
  it.each([
    { width: 82, overflow: 36, expected: 1 },
    { width: 92, overflow: 36, expected: 2 },
    { width: 132, overflow: 36, expected: 4 },
    { width: 152, overflow: 36, expected: 6 },
    { width: 132, overflow: 52, expected: 3 },
  ])('fits $expected exact-step previews in a $width px stack', ({ width, overflow, expected }) => {
    expect(getLauncherPreviewLimit(width, overflow, 6, 36, 16)).toBe(expected);
  });

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
