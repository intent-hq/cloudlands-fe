import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { stripAgentMessageHeader } from '../agent-message-attribution';
import {
  getPresentedUserMessageText,
  stripInternalDeliveryNotes,
  stripTruncatedTrailingDeliveryNote,
} from '../user-message-presentation';

const WAIT_NOTE =
  '[SYSTEM NOTE] This message was queued at 2026-08-17T05:00:00.123456Z and waited 1m 7s before delivery.';
const STALE_NOTE =
  '[SYSTEM NOTE] This message was queued before you completed; your completion report was already delivered to your parent at 2026-08-17T05:01:00Z. Only call reportToParent again if this message materially changes the outcome — do not re-send the same report.';

function user(text: string): AgentMessage {
  return {
    id: 'user-message',
    role: 'user',
    timestamp: '2026-08-17T05:00:00Z',
    contentBlocks: [{ type: 'text', text }],
    metadata: { queueInfo: { queuedAt: '2026-08-17T05:00:00.123456Z', waitedMs: 67_000 } },
  } as AgentMessage;
}

describe('user-message presentation sanitization', () => {
  it('removes one or multiple exact trailing delivery notes', () => {
    expect(stripInternalDeliveryNotes(`Ship café 你好 👩‍💻\n\n${WAIT_NOTE}`)).toBe(
      'Ship café 你好 👩‍💻',
    );
    expect(stripInternalDeliveryNotes(`Ship it\n\n${STALE_NOTE}\n\n${WAIT_NOTE}`)).toBe('Ship it');
    expect(stripInternalDeliveryNotes(`Ship it\r\n\r\n${WAIT_NOTE}\r\n\r\n${STALE_NOTE}`)).toBe(
      'Ship it',
    );
  });

  it('preserves authored literals, quotes, Markdown, and code', () => {
    const authored =
      'Keep [SYSTEM NOTE] in this prose.\n\n> [SYSTEM NOTE] quoted text\n\n```text\n' +
      `${WAIT_NOTE}\n` +
      '```';
    expect(stripInternalDeliveryNotes(authored)).toBe(authored);
    expect(stripInternalDeliveryNotes('[SYSTEM NOTE] This is user-authored text.')).toBe(
      '[SYSTEM NOTE] This is user-authored text.',
    );
    expect(stripInternalDeliveryNotes(`${WAIT_NOTE}\n\nKeep this trailing user paragraph.`)).toBe(
      `${WAIT_NOTE}\n\nKeep this trailing user paragraph.`,
    );
  });

  it('does not mutate canonical stored content or attachments', () => {
    const message = user(`Review the attachment\n\n${STALE_NOTE}\n\n${WAIT_NOTE}`);
    message.contentBlocks!.push({
      type: 'file',
      attachmentId: 'attachment-1',
      fileName: 'proof.txt',
      mimeType: 'text/plain',
    });
    const snapshot = structuredClone(message);

    expect(getPresentedUserMessageText(message)).toBe('Review the attachment');
    expect(message).toEqual(snapshot);
  });

  it('removes delivery notes split into trailing text blocks around attachments', () => {
    const message = user('Review the attachment');
    message.contentBlocks = [
      { type: 'text', text: 'Review the attachment' },
      { type: 'file', attachmentId: 'attachment-1', fileName: 'proof.txt' },
      { type: 'text', text: STALE_NOTE },
      { type: 'text', text: WAIT_NOTE },
    ];

    expect(getPresentedUserMessageText(message)).toBe('Review the attachment');
    expect(message.contentBlocks).toHaveLength(4);
  });
});

// PROTOCOL.md §5.5 A2A sender header, exactly as intentd prepends it.
const A2A_HEADER = '[MESSAGE FROM AGENT Research Agent (agent-1234)]';

function agentMessage(text: string, metadata?: Record<string, unknown>): AgentMessage {
  return {
    id: 'agent-origin-message',
    role: 'user',
    timestamp: '2026-08-17T05:00:00Z',
    contentBlocks: [{ type: 'text', text }],
    metadata: metadata ?? {
      type: 'agent_message',
      fromAgentId: 'agent-1234',
      fromAgentName: 'Research Agent',
    },
  } as AgentMessage;
}

describe('stripAgentMessageHeader', () => {
  it('strips the header line and its blank-line separator', () => {
    expect(stripAgentMessageHeader(`${A2A_HEADER}\n\nPlease review the diff.`)).toBe(
      'Please review the diff.',
    );
  });

  it('strips the name-absent header shape', () => {
    expect(stripAgentMessageHeader('[MESSAGE FROM AGENT (agent-1234)]\n\nPing')).toBe('Ping');
  });

  it('strips a header constituting the whole string (empty body)', () => {
    expect(stripAgentMessageHeader(A2A_HEADER)).toBe('');
  });

  it('preserves leading whitespace of the body (indented / code-formatted)', () => {
    expect(stripAgentMessageHeader(`${A2A_HEADER}\n\n    indented code line\ndone`)).toBe(
      '    indented code line\ndone',
    );
    expect(stripAgentMessageHeader(`${A2A_HEADER}\n\n\nextra blank belongs to body`)).toBe(
      '\nextra blank belongs to body',
    );
    expect(stripAgentMessageHeader(`${A2A_HEADER}\n\n\t tab-indented`)).toBe('\t tab-indented');
  });

  it('leaves a user-authored lookalike first line untouched', () => {
    const prose = '[MESSAGE FROM AGENT quoted prose]\n\nbody';
    expect(stripAgentMessageHeader(prose)).toBe(prose);
    const noIdTail = '[MESSAGE FROM AGENT Research Agent]\n\nbody';
    expect(stripAgentMessageHeader(noIdTail)).toBe(noIdTail);
  });

  it('returns text without the header unchanged', () => {
    expect(stripAgentMessageHeader('plain agent message')).toBe('plain agent message');
    expect(stripAgentMessageHeader(`Quoting:\n${A2A_HEADER}\ndone`)).toBe(
      `Quoting:\n${A2A_HEADER}\ndone`,
    );
  });

  it('strips the exact literal header rebuilt from attribution metadata', () => {
    const attribution = {
      kind: 'agent' as const,
      fromAgentId: 'agent-1234',
      displayName: 'Research Agent',
      rawName: 'Research Agent',
    };
    expect(stripAgentMessageHeader(`${A2A_HEADER}\n\nbody`, attribution)).toBe('body');
    expect(stripAgentMessageHeader(A2A_HEADER, attribution)).toBe('');
    expect(stripAgentMessageHeader(`${A2A_HEADER}\n\n    indented`, attribution)).toBe(
      '    indented',
    );
  });

  it('exact-literal path handles a name the regex fallback cannot match', () => {
    const rawName = 'Weird ) name (x)';
    const attribution = {
      kind: 'agent' as const,
      fromAgentId: 'agent-99Z',
      displayName: rawName,
      rawName,
    };
    const text = `[MESSAGE FROM AGENT ${rawName} (agent-99Z)]\n\nbody`;
    expect(stripAgentMessageHeader(text, attribution)).toBe('body');
  });

  it('exact-literal path strips the name-absent shape when rawName is empty', () => {
    const attribution = {
      kind: 'agent' as const,
      fromAgentId: 'agent-1234',
      displayName: 'Agent',
      rawName: '',
    };
    expect(stripAgentMessageHeader('[MESSAGE FROM AGENT (agent-1234)]\n\nPing', attribution)).toBe(
      'Ping',
    );
  });

  it('with attribution, a mismatched literal falls back to the pinned regex only', () => {
    const attribution = {
      kind: 'agent' as const,
      fromAgentId: 'agent-5678',
      displayName: 'Other',
      rawName: 'Other',
    };
    expect(stripAgentMessageHeader(`${A2A_HEADER}\n\nbody`, attribution)).toBe('body');
    const lookalike = '[MESSAGE FROM AGENT quoted prose]\n\nbody';
    expect(stripAgentMessageHeader(lookalike, attribution)).toBe(lookalike);
  });

  it('a chief attribution uses only the pinned regex fallback', () => {
    const attribution = { kind: 'chief' as const, fromAgentId: 'agent-chief' };
    expect(stripAgentMessageHeader(`${A2A_HEADER}\n\nbody`, attribution)).toBe('body');
    const lookalike = '[MESSAGE FROM AGENT quoted prose]\n\nbody';
    expect(stripAgentMessageHeader(lookalike, attribution)).toBe(lookalike);
  });
});

describe('A2A sender header presentation', () => {
  it('drops the header from attributed rows without mutating stored content', () => {
    const message = agentMessage(`${A2A_HEADER}\n\nPlease review the diff.`);
    const snapshot = structuredClone(message);

    expect(getPresentedUserMessageText(message)).toBe('Please review the diff.');
    expect(message).toEqual(snapshot);
  });

  it('renders attributed rows without the header byte-identically', () => {
    expect(getPresentedUserMessageText(agentMessage('plain agent message'))).toBe(
      'plain agent message',
    );
  });

  it('keeps a matching first line on rows without agent_message metadata', () => {
    const text = `${A2A_HEADER}\n\nUser-authored text.`;
    expect(getPresentedUserMessageText(agentMessage(text, {}))).toBe(text);
  });

  it('strips the header alongside a trailing dequeue-wait note', () => {
    const message = agentMessage(`${A2A_HEADER}\n\nShip it\n\n${WAIT_NOTE}`, {
      type: 'agent_message',
      fromAgentId: 'agent-1234',
      fromAgentName: 'Research Agent',
      queueInfo: { queuedAt: '2026-08-17T05:00:00.123456Z', waitedMs: 67_000 },
    });
    expect(getPresentedUserMessageText(message)).toBe('Ship it');
  });
});

describe('stripTruncatedTrailingDeliveryNote', () => {
  const queued = { queueInfo: { queuedAt: '2026-08-17T05:00:00Z', waitedMs: 8_000 } };

  it('drops a trailing note chopped mid-note by preview truncation', () => {
    expect(
      stripTruncatedTrailingDeliveryNote(
        'Keep this prompt\n\n[SYSTEM NOTE] This message was queued at 2026-08-17T0',
        queued,
      ),
    ).toBe('Keep this prompt');
    expect(
      stripTruncatedTrailingDeliveryNote('Keep this prompt\n\n[SYSTEM NOTE] This mess', queued),
    ).toBe('Keep this prompt');
  });

  it('keeps text without queueInfo metadata, authored brackets, and non-trailing notes', () => {
    const chopped = 'Keep this prompt\n\n[SYSTEM NOTE] This message was queued at 2026-08-17T0';
    expect(stripTruncatedTrailingDeliveryNote(chopped)).toBe(chopped);
    expect(stripTruncatedTrailingDeliveryNote(chopped, { queueInfo: {} })).toBe(chopped);
    expect(stripTruncatedTrailingDeliveryNote('Keep\n\n[SYSTEM NOTE] authored prose', queued)).toBe(
      'Keep\n\n[SYSTEM NOTE] authored prose',
    );
    expect(
      stripTruncatedTrailingDeliveryNote(`${WAIT_NOTE}\n\nKeep this trailing paragraph.`, queued),
    ).toBe(`${WAIT_NOTE}\n\nKeep this trailing paragraph.`);
  });
});
