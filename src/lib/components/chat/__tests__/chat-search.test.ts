import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { collectSearchRanges, findChatSearchMatches } from '../chat-search';

const assistant = (
  id: string,
  contentBlocks: AgentMessage['contentBlocks'],
  isStreaming = false,
): AgentMessage => ({ id, role: 'assistant', contentBlocks, isStreaming }) as AgentMessage;

describe('chat search utilities', () => {
  it('indexes completed response group text with the disclosure path needed to reveal it', () => {
    const message = assistant('assistant-1', [
      { type: 'text', text: '<group:Completed>visible summary' },
      { type: 'text', text: 'hidden detail</group>' },
    ]);

    expect(findChatSearchMatches([message], 'hidden', new Map())).toEqual([
      {
        messageId: 'assistant-1',
        matchIndexInMessage: 0,
        occurrenceInBlock: 0,
        turnKey: 'assistant-1',
        blockPath: 'b:0:c:1',
        disclosurePath: ['group:b:0'],
      },
    ]);
    expect(
      findChatSearchMatches([message], 'summary', new Map([['assistant-1', 'turn-1']])),
    ).toEqual([
      {
        messageId: 'assistant-1',
        matchIndexInMessage: 0,
        occurrenceInBlock: 0,
        turnKey: 'turn-1',
        blockPath: 'b:0:c:0',
        disclosurePath: ['group:b:0'],
      },
    ]);
  });

  it('indexes only the current visible child in a live response group', () => {
    const message = assistant(
      'assistant-live',
      [
        { type: 'text', text: '<group:Live>hidden earlier detail' },
        { type: 'text', text: 'current live detail' },
        { type: 'tool_result', tool_use_id: 'tool-1', output: 'not a visible row' },
      ],
      true,
    );

    expect(findChatSearchMatches([message], 'earlier', new Map())).toEqual([]);
    expect(findChatSearchMatches([message], 'current live', new Map())).toEqual([
      {
        messageId: 'assistant-live',
        matchIndexInMessage: 0,
        occurrenceInBlock: 0,
        turnKey: 'assistant-live',
        blockPath: 'b:0:c:1',
        disclosurePath: [],
      },
    ]);
  });

  it.each([1, 2, 4])(
    'indexes the adjacent description across %i absorbed histories in a live group',
    (historyCount) => {
      const histories = Array.from({ length: historyCount }, (_, index) => ({
        type: 'thinking' as const,
        text:
          index === historyCount - 1
            ? `**Hidden predecessor reasoning ${index + 1}**\n\n**Rendered group title**`
            : `Hidden predecessor reasoning ${index + 1}.`,
      }));
      const message = assistant(
        `assistant-adjacent-preview-${historyCount}`,
        [
          ...histories,
          {
            type: 'text',
            text: '<group:Prepping>Rendered adjacent description',
          },
        ],
        true,
      );

      expect(findChatSearchMatches([message], 'adjacent description', new Map())).toEqual([
        {
          messageId: `assistant-adjacent-preview-${historyCount}`,
          matchIndexInMessage: 0,
          occurrenceInBlock: 0,
          turnKey: `assistant-adjacent-preview-${historyCount}`,
          blockPath: 'b:0:c:0',
          disclosurePath: ['group:b:0'],
        },
      ]);
      expect(findChatSearchMatches([message], 'Hidden predecessor', new Map())).toEqual([]);
    },
  );

  it('indexes a later meaningful reasoning title through the group disclosure', () => {
    const blocks = [
      { type: 'text', text: '<group:Prepping>hidden group description' },
      { type: 'thinking', text: 'Reasoning\n\nhidden first reasoning body' },
      { type: 'thinking', text: 'Planning clarification\n\nhidden later reasoning body' },
      { type: 'text', text: '</group:Prepping>visible final prose' },
    ] as AgentMessage['contentBlocks'];

    const hiddenMatches = findChatSearchMatches(
      [assistant('alternate-complete', blocks)],
      'hidden',
      new Map(),
    );
    expect(hiddenMatches).toHaveLength(3);
    expect(hiddenMatches.every((match) => match.disclosurePath[0] === 'group:b:0')).toBe(true);
    expect(
      findChatSearchMatches([assistant('alternate-complete', blocks)], 'visible final', new Map()),
    ).toHaveLength(1);
  });

  it('indexes completed headingless reasoning behind its group disclosure', () => {
    const message = assistant('disclosed-headingless', [
      {
        type: 'thinking',
        text: 'Disclosed headingless search target is available after opening the group.',
      },
      { type: 'text', text: '<group:Prepping>Disclosed group description.' },
      { type: 'thinking', text: 'Later disclosed reasoning stays in source order.' },
      { type: 'text', text: '</group:Prepping>Visible final prose.' },
    ]);

    expect(findChatSearchMatches([message], 'headingless search target', new Map())).toEqual([
      {
        messageId: 'disclosed-headingless',
        matchIndexInMessage: 0,
        occurrenceInBlock: 0,
        turnKey: 'disclosed-headingless',
        blockPath: 'b:0:c:1:p:0:body',
        disclosurePath: ['group:b:0', 'reasoning:b:0:c:1:p:0'],
      },
    ]);
  });

  it('gives a reasoning phase title and body distinct targets in result order', () => {
    const message = assistant('phase-targets', [
      { type: 'text', text: '<group:Prepping>Group description.' },
      { type: 'thinking', text: 'Initial group title\n\nInitial group body.' },
      {
        type: 'thinking',
        text: 'Title-only marker shared-marker\n\nBody-only marker shared-marker.',
      },
      { type: 'text', text: '</group:Prepping>Final prose.' },
    ]);

    expect(findChatSearchMatches([message], 'Title-only marker', new Map())).toEqual([
      expect.objectContaining({
        blockPath: 'b:0:c:2:p:0:summary',
        disclosurePath: ['group:b:0', 'reasoning:b:0:c:2:p:0'],
      }),
    ]);
    expect(findChatSearchMatches([message], 'Body-only marker', new Map())).toEqual([
      expect.objectContaining({
        blockPath: 'b:0:c:2:p:0:body',
        disclosurePath: ['group:b:0', 'reasoning:b:0:c:2:p:0'],
      }),
    ]);
    expect(findChatSearchMatches([message], 'shared-marker', new Map())).toEqual([
      expect.objectContaining({
        matchIndexInMessage: 0,
        blockPath: 'b:0:c:2:p:0:summary',
      }),
      expect.objectContaining({
        matchIndexInMessage: 1,
        blockPath: 'b:0:c:2:p:0:body',
      }),
    ]);
  });

  it('indexes standalone reasoning title and collapsed body without reclassifying final prose', () => {
    const message = assistant('standalone-reasoning', [
      {
        type: 'thinking',
        text: 'Standalone reasoning title\n\nHidden standalone reasoning target.',
      },
      { type: 'text', text: 'Visible final prose guard.' },
    ]);

    expect(findChatSearchMatches([message], 'Standalone reasoning title', new Map())).toEqual([
      {
        messageId: 'standalone-reasoning',
        matchIndexInMessage: 0,
        occurrenceInBlock: 0,
        turnKey: 'standalone-reasoning',
        blockPath: 'b:0:summary',
        disclosurePath: [],
      },
    ]);
    expect(
      findChatSearchMatches([message], 'Hidden standalone reasoning target', new Map()),
    ).toEqual([
      {
        messageId: 'standalone-reasoning',
        matchIndexInMessage: 0,
        occurrenceInBlock: 0,
        turnKey: 'standalone-reasoning',
        blockPath: 'b:0:body',
        disclosurePath: ['reasoning:b:0'],
      },
    ]);
    expect(findChatSearchMatches([message], 'Visible final prose guard', new Map())).toEqual([
      {
        messageId: 'standalone-reasoning',
        matchIndexInMessage: 0,
        occurrenceInBlock: 0,
        turnKey: 'standalone-reasoning',
        blockPath: 'b:1',
        disclosurePath: [],
      },
    ]);
  });

  it('reveals meaningfully titled completed reasoning while preserving generic exclusions', () => {
    const message = assistant('titled-reasoning', [
      { type: 'text', text: '<group:Prepping>Visible titled description.' },
      {
        type: 'thinking',
        text: 'Reasoning\n\n**Model-derived reasoning title**\n\nHidden titled reasoning search target.',
      },
      { type: 'text', text: '</group:Prepping>Visible final prose.' },
    ]);

    expect(findChatSearchMatches([message], 'titled reasoning search target', new Map())).toEqual([
      {
        messageId: 'titled-reasoning',
        matchIndexInMessage: 0,
        occurrenceInBlock: 0,
        turnKey: 'titled-reasoning',
        blockPath: 'b:0:c:1:p:0:body',
        disclosurePath: ['group:b:0', 'reasoning:b:0:c:1:p:0'],
      },
    ]);
    expect(findChatSearchMatches([message], 'Model-derived reasoning title', new Map())).toEqual([
      {
        messageId: 'titled-reasoning',
        matchIndexInMessage: 0,
        occurrenceInBlock: 0,
        turnKey: 'titled-reasoning',
        blockPath: 'b:0:summary',
        disclosurePath: [],
      },
    ]);
  });

  it('does not index exact delivery notes on user messages', () => {
    const note =
      '[SYSTEM NOTE] This message was queued at 2026-01-01T00:00:00Z and waited 8s before delivery.';
    const message = {
      id: 'user-queued',
      role: 'user',
      contentBlocks: [{ type: 'text', text: `Visible prompt\n\n${note}` }],
      metadata: { queueInfo: { queuedAt: '2026-01-01T00:00:00Z', waitedMs: 8_000 } },
    } as AgentMessage;

    expect(findChatSearchMatches([message], 'Visible', new Map())).toHaveLength(1);
    expect(findChatSearchMatches([message], 'queued at', new Map())).toEqual([]);
  });

  it('preserves ordinary text, event exclusions, and suggested-prompt cleanup', () => {
    const ordinary = assistant('assistant-ordinary', [
      {
        type: 'text',
        text: 'Searchable prose.\n\n<!-- suggested-prompts\nHidden suggested action\n-->',
      },
    ]);
    const event = {
      id: 'user-event',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'Hidden event payload' }],
      metadata: { type: 'event_notification' },
    } as AgentMessage;
    const workspaceEvents = {
      id: 'user-workspace-events',
      role: 'user',
      contentBlocks: [{ type: 'text', text: '[WORKSPACE EVENTS] Hidden workspace payload' }],
    } as AgentMessage;

    expect(findChatSearchMatches([ordinary], 'Searchable prose', new Map())).toHaveLength(1);
    expect(findChatSearchMatches([ordinary], 'Hidden suggested action', new Map())).toEqual([]);
    expect(findChatSearchMatches([event], 'Hidden event payload', new Map())).toEqual([]);
    expect(findChatSearchMatches([workspaceEvents], 'Hidden workspace payload', new Map())).toEqual(
      [],
    );
  });

  it('creates a range for a match spanning multiple text nodes', () => {
    const element = document.createElement('div');
    element.innerHTML = '<span>cross</span><span>node</span><input value="ignored" />';
    const ranges = collectSearchRanges(element, 'crossnode');

    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('crossnode');
  });
});
