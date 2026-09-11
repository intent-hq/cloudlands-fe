import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import {
  createChatTranscriptStructureProjector,
  getLiveStreamingAssistantMessage,
} from '../chat-transcript-structure';

const timestamp = '2026-01-01T00:00:00.000Z';
const protocolTranscript: AgentMessage[] = [
  { id: 'user-1', role: 'user', timestamp, contentBlocks: [{ type: 'text', text: 'Inspect' }] },
  {
    id: 'assistant-1',
    role: 'assistant',
    timestamp,
    metadata: { auggieSessionId: 'session-old' },
    contentBlocks: [
      { type: 'tool_use', id: 'assistant-1:0', toolCallId: 'call-1', name: 'view', input: {} },
      { type: 'tool_result', id: 'assistant-1:1', tool_use_id: 'call-1', output: 'ok' },
    ],
  },
  { id: 'user-2', role: 'user', timestamp, contentBlocks: [{ type: 'text', text: 'Continue' }] },
  {
    id: 'assistant-2',
    role: 'assistant',
    timestamp,
    metadata: { auggieSessionId: 'session-latest' },
    contentBlocks: [{ type: 'text', text: 'Working' }],
  },
];

describe('chat transcript structural projection', () => {
  it('derives the protocol-shaped transcript structure in one pass', () => {
    const project = createChatTranscriptStructureProjector();
    const structure = project({
      messages: protocolTranscript,
      isStreaming: true,
      isActive: true,
      snapshotSequence: 1,
    });

    expect({
      latestSessionId: structure.latestAuggieSessionId,
      userTurnCount: structure.userTurnCount,
      assistantMessageIds: [...structure.assistantMessageIds],
      indexes: Object.fromEntries(structure.messageIndexById),
      turns: Object.fromEntries(structure.assistantTurnNumberById),
      unique: structure.hasUniqueMessageIds,
    }).toEqual({
      latestSessionId: 'session-latest',
      userTurnCount: 2,
      assistantMessageIds: ['assistant-1', 'assistant-2'],
      indexes: { 'user-1': 0, 'assistant-1': 1, 'user-2': 2, 'assistant-2': 3 },
      turns: { 'assistant-1': 1, 'assistant-2': 2 },
      unique: true,
    });
    expect(structure.recomputeCount).toBe(1);
  });

  it('keeps volatile tail content live without a structural recompute', () => {
    const project = createChatTranscriptStructureProjector();
    const initial = project({
      messages: protocolTranscript,
      isStreaming: true,
      isActive: true,
      snapshotSequence: 1,
    });
    const streamed = [
      ...protocolTranscript.slice(0, -1),
      {
        ...protocolTranscript.at(-1)!,
        contentBlocks: [{ type: 'text' as const, text: 'Working complete' }],
      },
    ];
    const afterChunk = project({
      messages: streamed,
      isStreaming: true,
      isActive: true,
      snapshotSequence: 1,
    });

    expect(afterChunk).toBe(initial);
    expect(afterChunk.recomputeCount).toBe(1);
    expect(getLiveStreamingAssistantMessage(streamed, afterChunk, true)?.contentBlocks).toEqual([
      { type: 'text', text: 'Working complete' },
    ]);
  });

  it('recomputes when an earlier row changes alongside a same-shape streaming tail', () => {
    const project = createChatTranscriptStructureProjector();
    const initial = project({
      messages: protocolTranscript,
      isStreaming: true,
      isActive: true,
      snapshotSequence: 1,
    });
    const replaced = protocolTranscript.map((message, index) => {
      if (index === 1) return { ...message, id: 'assistant-replaced' } as AgentMessage;
      if (index === protocolTranscript.length - 1) {
        return {
          ...message,
          contentBlocks: [{ type: 'text' as const, text: 'Still working' }],
        } as AgentMessage;
      }
      return message;
    });

    const structure = project({
      messages: replaced,
      isStreaming: true,
      isActive: true,
      snapshotSequence: 1,
    });

    expect(structure.recomputeCount).toBe(initial.recomputeCount + 1);
    expect(Object.fromEntries(structure.messageIndexById)).toEqual({
      'user-1': 0,
      'assistant-replaced': 1,
      'user-2': 2,
      'assistant-2': 3,
    });
    expect([...structure.assistantMessageIds]).toEqual(['assistant-replaced', 'assistant-2']);
  });

  it('recomputes for append, prepend, replacement, and reorder updates', () => {
    const project = createChatTranscriptStructureProjector();
    let structure = project({
      messages: protocolTranscript,
      isStreaming: false,
      isActive: true,
      snapshotSequence: 1,
    });
    const appended = [
      ...protocolTranscript,
      { id: 'user-3', role: 'user', timestamp } as AgentMessage,
    ];
    structure = project({
      messages: appended,
      isStreaming: false,
      isActive: true,
      snapshotSequence: 1,
    });
    const prepended = [{ id: 'system-0', role: 'system', timestamp } as AgentMessage, ...appended];
    structure = project({
      messages: prepended,
      isStreaming: false,
      isActive: true,
      snapshotSequence: 1,
    });
    const replaced = prepended.map((message, index) =>
      index === 2 ? ({ ...message, id: 'assistant-replaced' } as AgentMessage) : message,
    );
    structure = project({
      messages: replaced,
      isStreaming: false,
      isActive: true,
      snapshotSequence: 1,
    });
    const reordered = [replaced[0], replaced[2], replaced[1], ...replaced.slice(3)];
    structure = project({
      messages: reordered,
      isStreaming: false,
      isActive: true,
      snapshotSequence: 1,
    });

    structure = project({
      messages: reordered,
      isStreaming: false,
      isActive: true,
      snapshotSequence: 2,
    });

    expect(structure.recomputeCount).toBe(6);
    expect(structure.messageIndexById.get('assistant-replaced')).toBe(1);
    expect(structure.hasUniqueMessageIds).toBe(true);
  });

  it('catches up once when a retained panel reactivates', () => {
    const project = createChatTranscriptStructureProjector();
    const active = project({
      messages: protocolTranscript,
      isStreaming: true,
      isActive: true,
      snapshotSequence: 1,
    });
    const replacedSnapshot = protocolTranscript.slice(0, 2);
    const inactive = project({
      messages: replacedSnapshot,
      isStreaming: false,
      isActive: false,
      snapshotSequence: undefined,
    });
    const reactivated = project({
      messages: replacedSnapshot,
      isStreaming: false,
      isActive: true,
      snapshotSequence: 1,
    });

    expect(inactive).toBe(active);
    expect(reactivated.recomputeCount).toBe(active.recomputeCount + 1);
    expect([...reactivated.messageIndexById.keys()]).toEqual(['user-1', 'assistant-1']);
  });
});
