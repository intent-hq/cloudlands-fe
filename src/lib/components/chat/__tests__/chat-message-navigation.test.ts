import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import {
  getMessageNavigationStartScrollTop,
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

function source(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('chat user-message navigation', () => {
  it('aligns start navigation to the rendered header edge at whole and fractional zoom geometry', () => {
    expect(
      getMessageNavigationStartScrollTop({
        currentScrollTop: 400,
        targetTop: 219,
        containerTop: 120,
        headerBottom: 120,
      }),
    ).toBe(499);
    expect(
      getMessageNavigationStartScrollTop({
        currentScrollTop: 400,
        targetTop: 219.5,
        containerTop: 120,
        headerBottom: 120.5,
      }),
    ).toBe(499);
  });

  it('does not place a selected target under a header that overlaps the scroll viewport', () => {
    expect(
      getMessageNavigationStartScrollTop({
        currentScrollTop: 400,
        targetTop: 219,
        containerTop: 120,
        headerBottom: 121,
      }),
    ).toBe(498);
  });

  it('uses rendered panel-header geometry for start-aligned message navigation', () => {
    const panel = source('src/lib/components/chat/ChatPanel.svelte');

    expect(panel).toContain("querySelectorAll<HTMLElement>('[data-panel-content-header]')");
    expect(panel).toContain('headerBottom: getRenderedPanelHeaderBottom()');
    expect(panel).not.toContain(
      'scrollContainer.scrollTop + (elementRect.top - containerRect.top) + 1',
    );
  });

  it('extracts plain-text previews from user-authored text', () => {
    expect(getPlainTextMessagePreview(message('1', 'user', '# **Plan**\n\nUse `pnpm`'))).toBe(
      'Plan Use pnpm',
    );
  });

  it('strips the exact system-note marker and suffix from previews without changing source data', () => {
    const source = message(
      'system-note',
      'user',
      'Keep this prompt\n\n[SYSTEM NOTE] This internal suffix must not appear',
    );
    expect(getPlainTextMessagePreview(source)).toBe('Keep this prompt');
    expect(getUserMessageNavigationItems([source])).toEqual([
      { id: 'system-note', text: 'Keep this prompt' },
    ]);
    expect(source.contentBlocks[0]).toEqual({
      type: 'text',
      text: 'Keep this prompt\n\n[SYSTEM NOTE] This internal suffix must not appear',
    });
  });

  it('omits user rows that are empty after system-note stripping', () => {
    expect(
      getUserMessageNavigationItems([
        message('empty-system-note', 'user', '[SYSTEM NOTE] Internal suffix only'),
        message('similar-marker', 'user', '[System Note] Keep this differently-cased text'),
      ]),
    ).toEqual([{ id: 'similar-marker', text: '[System Note] Keep this differently-cased text' }]);
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
});
