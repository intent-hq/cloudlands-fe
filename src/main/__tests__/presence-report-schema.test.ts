import { describe, expect, it } from 'vitest';
import { PresenceReportSchema } from '../ipc-schemas';

describe('presence report discussion typing IPC', () => {
  it('preserves both typing channels through validation and accepts omitted/null discussion targets', () => {
    const report = {
      focus: [{ workspaceId: 'ws' }],
      typing: { agentId: 'agent' },
      discussionTyping: { workspaceId: 'ws' },
    };
    expect(PresenceReportSchema.parse(report)).toEqual(report);
    expect(PresenceReportSchema.parse({ focus: [], discussionTyping: null })).toEqual({
      focus: [],
      discussionTyping: null,
    });
    expect(PresenceReportSchema.parse({ focus: [] })).toEqual({ focus: [] });
  });
  it.each([{ workspaceId: '' }, { workspaceId: 1 }, { agentId: 'agent' }, []])(
    'rejects invalid discussion targets',
    (discussionTyping) => {
      expect(PresenceReportSchema.safeParse({ focus: [], discussionTyping }).success).toBe(false);
    },
  );
});
