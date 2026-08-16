import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import {
  filterUserMessageNavigationItems,
  getPlainTextMessagePreview,
  getUserMessageNavigationItems,
} from '../chat-message-navigation';

function message(
  id: string,
  role: AgentMessage['role'],
  text?: string,
  metadata?: AgentMessage['metadata'],
): AgentMessage {
  return {
    id,
    role,
    timestamp: '2026-01-01T00:00:00.000Z',
    contentBlocks:
      text === undefined ? [{ type: 'tool_use', name: 'read' }] : [{ type: 'text', text }],
    metadata,
  } as AgentMessage;
}

describe('chat user-message navigation', () => {
  it('extracts plain-text previews from user-authored text', () => {
    expect(getPlainTextMessagePreview(message('1', 'user', '# **Plan**\n\nUse `pnpm`'))).toBe(
      'Plan Use pnpm',
    );
  });

  it('keeps stable message order, deduplicates IDs, and keeps repeated content', () => {
    const items = getUserMessageNavigationItems([
      message('u-2', 'user', 'Repeat'),
      message('u-1', 'user', 'First'),
      message('u-2', 'user', 'Duplicate envelope'),
      message('u-3', 'user', 'Repeat'),
    ]);
    expect(items).toEqual([
      { id: 'u-2', text: 'Repeat' },
      { id: 'u-1', text: 'First' },
      { id: 'u-3', text: 'Repeat' },
    ]);
  });

  it('excludes assistant, system, tool-only, and automated user rows', () => {
    const items = getUserMessageNavigationItems([
      message('assistant', 'assistant', 'Answer'),
      message('system', 'system', 'System notice'),
      message('tool-only', 'user'),
      message('event', 'user', 'Event wake', { type: 'event_notification' }),
      message('legacy-event', 'user', '[WORKSPACE EVENTS] changed'),
      message('user', 'user', 'Keep me'),
    ]);
    expect(items).toEqual([{ id: 'user', text: 'Keep me' }]);
  });

  it('filters case-insensitively without changing stable order', () => {
    const items = [
      { id: '1', text: 'Alpha release' },
      { id: '2', text: 'Beta ALPHA notes' },
      { id: '3', text: 'Gamma' },
    ];
    expect(filterUserMessageNavigationItems(items, ' alpha ')).toEqual(items.slice(0, 2));
    expect(filterUserMessageNavigationItems(items, '')).toEqual(items);
  });

  it('returns an empty state for no matching user messages', () => {
    expect(filterUserMessageNavigationItems([], 'anything')).toEqual([]);
    expect(filterUserMessageNavigationItems([{ id: '1', text: 'Alpha' }], 'beta')).toEqual([]);
  });
});
