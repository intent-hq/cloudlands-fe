import { describe, expect, it } from 'vitest';
import { shouldHandleChatFocusRequest } from '../chat-focus-ownership';

const owner = {
  agentId: 'agent-a',
  workspaceId: 'workspace-a',
  panelId: 'panel-a',
  isActive: true,
  isPanelFocused: true,
};

describe('chat focus ownership', () => {
  it('accepts focus only for the active chat in the focused target panel', () => {
    expect(
      shouldHandleChatFocusRequest(
        {
          tabType: 'agent',
          agentId: 'agent-a',
          workspaceId: 'workspace-a',
          panelId: 'panel-a',
        },
        owner,
      ),
    ).toBe(true);
  });

  it.each([
    ['another agent', { agentId: 'agent-b' }, owner],
    ['another workspace', { workspaceId: 'workspace-b' }, owner],
    ['another panel', { panelId: 'panel-b' }, owner],
    ['an inactive tab', {}, { ...owner, isActive: false }],
    ['an unfocused panel', {}, { ...owner, isPanelFocused: false }],
  ])('rejects a delayed request for %s', (_label, requestOverrides, ownerOverrides) => {
    expect(
      shouldHandleChatFocusRequest(
        {
          tabType: 'agent',
          agentId: 'agent-a',
          workspaceId: 'workspace-a',
          panelId: 'panel-a',
          ...requestOverrides,
        },
        ownerOverrides,
      ),
    ).toBe(false);
  });

  it('allows non-panel chats to receive their own explicit focus request', () => {
    expect(
      shouldHandleChatFocusRequest(
        { tabType: 'agent', agentId: 'agent-a' },
        { ...owner, panelId: null, isPanelFocused: false },
      ),
    ).toBe(true);
  });

  it('accepts a dictation-flagged request for an unfocused panel (mid-dictation panel switch)', () => {
    expect(
      shouldHandleChatFocusRequest(
        { tabType: 'agent', agentId: 'agent-a', source: 'dictation' },
        { ...owner, isPanelFocused: false },
      ),
    ).toBe(true);
  });

  it.each([
    ['another agent', { agentId: 'agent-b' }, owner],
    ['another workspace', { workspaceId: 'workspace-b' }, owner],
    ['another panel', { panelId: 'panel-b' }, owner],
    ['an inactive tab', {}, { ...owner, isActive: false }],
  ])('rejects a dictation-flagged request for %s', (_label, requestOverrides, ownerOverrides) => {
    expect(
      shouldHandleChatFocusRequest(
        {
          tabType: 'agent',
          agentId: 'agent-a',
          workspaceId: 'workspace-a',
          source: 'dictation',
          ...requestOverrides,
        },
        { ...ownerOverrides, isPanelFocused: false },
      ),
    ).toBe(false);
  });
});
