import { describe, expect, it } from 'vitest';
import { isDelegatedBackgroundTaskSession } from '../agent-session-metadata';

describe('agent session metadata utilities', () => {
  it('detects delegated background task sessions', () => {
    expect(
      isDelegatedBackgroundTaskSession({
        metadata: {
          isBackground: true,
          createdByAgentId: 'parent-agent',
          taskNoteId: 'task-1',
        },
      }),
    ).toBe(true);

    expect(isDelegatedBackgroundTaskSession({ metadata: { isBackground: true } })).toBe(false);
    expect(isDelegatedBackgroundTaskSession(null)).toBe(false);
  });
});
