import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import type { UserMessageIndexItem } from '$lib/client';
import {
  getMessageNavigationStartScrollTop,
  getPlainTextMessagePreview,
  getUserMessageNavigationItems,
  getUserMessageNavigationItemsFromIndex,
  mergeUserMessageNavigationItems,
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

  it('strips exact trailing delivery notes without changing source data', () => {
    const note =
      '[SYSTEM NOTE] This message was queued at 2026-01-01T00:00:00Z and waited 8s before delivery.';
    const source = message('system-note', 'user', `Keep this prompt\n\n${note}`);
    expect(getPlainTextMessagePreview(source)).toBe('Keep this prompt');
    expect(getUserMessageNavigationItems([source])).toEqual([
      { id: 'system-note', text: 'Keep this prompt' },
    ]);
    expect(source.contentBlocks[0]).toEqual({
      type: 'text',
      text: `Keep this prompt\n\n${note}`,
    });
  });

  it('preserves arbitrary authored system-note literals', () => {
    expect(
      getUserMessageNavigationItems([
        message('authored-system-note', 'user', '[SYSTEM NOTE] Internal suffix only'),
        message('similar-marker', 'user', '[System Note] Keep this differently-cased text'),
      ]),
    ).toEqual([
      { id: 'authored-system-note', text: '[SYSTEM NOTE] Internal suffix only' },
      { id: 'similar-marker', text: '[System Note] Keep this differently-cased text' },
    ]);
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

function indexItem(
  id: string,
  preview: string,
  metadata?: Record<string, unknown>,
): UserMessageIndexItem {
  return { id, preview, createdAt: '2026-01-01T00:00:00.000Z', ...(metadata ? { metadata } : {}) };
}

describe('full-history index navigation items', () => {
  it('normalizes previews, deduplicates IDs, and drops empty rows', () => {
    const items = getUserMessageNavigationItemsFromIndex([
      indexItem('i-1', '# **Plan**\n\nUse `pnpm`'),
      indexItem('i-1', 'Duplicate envelope'),
      indexItem('i-2', '   \n\t'),
      indexItem('i-3', 'Second prompt'),
    ]);
    expect(items).toEqual([
      { id: 'i-1', text: 'Plan Use pnpm' },
      { id: 'i-3', text: 'Second prompt' },
    ]);
  });

  it('excludes automated index rows by metadata type and legacy prefixes', () => {
    const items = getUserMessageNavigationItemsFromIndex([
      indexItem('event', 'Event wake', { type: 'event_notification' }),
      indexItem('legacy-event', '[WORKSPACE EVENTS] changed'),
      indexItem('task-wake', '  [TASK WAKE] resume'),
      indexItem('agent-message', '[AGENT MESSAGE] hello'),
      indexItem('user', 'Keep me'),
    ]);
    expect(items).toEqual([{ id: 'user', text: 'Keep me' }]);
  });

  it('strips exact trailing delivery notes from index previews', () => {
    const note =
      '[SYSTEM NOTE] This message was queued at 2026-01-01T00:00:00Z and waited 8s before delivery.';
    expect(
      getUserMessageNavigationItemsFromIndex([indexItem('noted', `Keep this prompt\n\n${note}`)]),
    ).toEqual([{ id: 'noted', text: 'Keep this prompt' }]);
    expect(
      getUserMessageNavigationItemsFromIndex([
        indexItem('authored', '[SYSTEM NOTE] Internal suffix only'),
      ]),
    ).toEqual([{ id: 'authored', text: '[SYSTEM NOTE] Internal suffix only' }]);
  });
});

describe('mergeUserMessageNavigationItems', () => {
  it('keeps index order, prefers tail text by id, and appends tail-only rows', () => {
    const merged = mergeUserMessageNavigationItems(
      [
        { id: 'old-1', text: 'Oldest prompt' },
        { id: 'shared', text: 'Stale index preview' },
      ],
      [
        { id: 'shared', text: 'Fresh tail text' },
        { id: 'streaming', text: 'Just sent' },
      ],
    );
    expect(merged).toEqual([
      { id: 'old-1', text: 'Oldest prompt' },
      { id: 'shared', text: 'Fresh tail text' },
      { id: 'streaming', text: 'Just sent' },
    ]);
  });

  it('degrades to tail-only when the index is empty and index-only when the tail is empty', () => {
    const tail = [{ id: 'tail', text: 'Tail row' }];
    const index = [{ id: 'index', text: 'Index row' }];
    expect(mergeUserMessageNavigationItems([], tail)).toEqual(tail);
    expect(mergeUserMessageNavigationItems(index, [])).toEqual(index);
  });

  it('produces no duplicate ids when every tail row is indexed', () => {
    const merged = mergeUserMessageNavigationItems(
      [
        { id: 'a', text: 'A (index)' },
        { id: 'b', text: 'B (index)' },
      ],
      [
        { id: 'a', text: 'A (tail)' },
        { id: 'b', text: 'B (tail)' },
      ],
    );
    expect(merged).toEqual([
      { id: 'a', text: 'A (tail)' },
      { id: 'b', text: 'B (tail)' },
    ]);
  });
});
