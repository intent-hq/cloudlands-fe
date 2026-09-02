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

  it('indexes every visible child in a live response group without a disclosure path', () => {
    const message = assistant(
      'assistant-live',
      [
        { type: 'text', text: '<group:Live>visible earlier detail' },
        { type: 'text', text: 'current live detail' },
        { type: 'tool_result', tool_use_id: 'tool-1', output: 'not a visible row' },
      ],
      true,
    );

    expect(findChatSearchMatches([message], 'earlier', new Map())).toEqual([
      {
        messageId: 'assistant-live',
        matchIndexInMessage: 0,
        occurrenceInBlock: 0,
        turnKey: 'assistant-live',
        blockPath: 'b:0:c:0',
        disclosurePath: [],
      },
    ]);
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

  it('indexes every adjacent child rendered by both live renderers', () => {
    const message = assistant(
      'assistant-adjacent-preview',
      [
        {
          type: 'thinking',
          text: '**Hidden predecessor reasoning**\n\n**Rendered group title**',
        },
        {
          type: 'text',
          text: '<group:Prepping>Rendered adjacent description',
        },
      ],
      true,
    );

    expect(findChatSearchMatches([message], 'adjacent description', new Map())).toHaveLength(1);
    expect(findChatSearchMatches([message], 'Hidden predecessor', new Map())).toEqual([
      {
        messageId: 'assistant-adjacent-preview',
        matchIndexInMessage: 0,
        occurrenceInBlock: 0,
        turnKey: 'assistant-adjacent-preview',
        blockPath: 'b:0:c:1',
        disclosurePath: [],
      },
    ]);
  });

  it('excludes the alternate reasoning description and history while collapsed', () => {
    const blocks = [
      { type: 'text', text: '<group:Prepping>hidden group description' },
      { type: 'thinking', text: 'Reasoning\n\nhidden first reasoning body' },
      { type: 'thinking', text: 'Planning clarification\n\nhidden later reasoning body' },
      { type: 'text', text: '</group:Prepping>visible final prose' },
    ] as AgentMessage['contentBlocks'];

    expect(
      findChatSearchMatches([assistant('alternate-complete', blocks)], 'hidden', new Map()),
    ).toEqual([]);
    expect(
      findChatSearchMatches([assistant('alternate-complete', blocks)], 'visible final', new Map()),
    ).toHaveLength(1);
  });

  it('indexes completed headingless reasoning inline without disclosure state', () => {
    const message = assistant('inline-headingless', [
      {
        type: 'thinking',
        text: 'Inline headingless search target remains visible without opening anything.',
      },
      { type: 'text', text: '<group:Prepping>Visible inline description.' },
      { type: 'thinking', text: 'Later inline reasoning stays visible in source order.' },
      { type: 'text', text: '</group:Prepping>Visible final prose.' },
    ]);

    expect(findChatSearchMatches([message], 'headingless search target', new Map())).toEqual([
      {
        messageId: 'inline-headingless',
        matchIndexInMessage: 0,
        occurrenceInBlock: 0,
        turnKey: 'inline-headingless',
        blockPath: 'b:0:c:1',
        disclosurePath: [],
      },
    ]);
  });

  it('reveals meaningfully titled completed reasoning while preserving generic exclusions', () => {
    const message = assistant('titled-reasoning', [
      { type: 'text', text: '<group:Prepping>Visible titled description.' },
      {
        type: 'thinking',
        text: 'Model-derived reasoning title\n\nHidden titled reasoning search target.',
      },
      { type: 'text', text: '</group:Prepping>Visible final prose.' },
    ]);

    expect(findChatSearchMatches([message], 'titled reasoning search target', new Map())).toEqual([
      {
        messageId: 'titled-reasoning',
        matchIndexInMessage: 0,
        occurrenceInBlock: 0,
        turnKey: 'titled-reasoning',
        blockPath: 'b:0:c:1',
        disclosurePath: ['group:b:0'],
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
