import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { stripAgentMessageHeader } from '../agent-message-attribution';
import {
  buildCollaboratorSenderPreamble,
  getCollaboratorSenderAttribution,
} from '../collaborator-sender-attribution';
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

  // Older daemons persisted inline file bytes on the block; the daemon's
  // `degrade_inline_file_blocks` pass now serves that row with each such block
  // replaced in place by `{ type: 'text', text: 'Attached file: <fileName>' }`.
  // The FE mirrors that
  // projection for a legacy block, in block order, and never surfaces the bytes.
  it('presents a legacy inline file block (no attachmentId) as attached-file text', () => {
    const message = user('Review the attachment');
    message.contentBlocks = [
      { type: 'text', text: 'Review the attachment ' },
      { type: 'file', data: 'aGVsbG8=', mimeType: 'text/plain', fileName: ' notes.txt ' },
      { type: 'file', data: 'aGVsbG8=', mimeType: 'application/octet-stream' },
      { type: 'text', text: WAIT_NOTE },
    ];

    const presented = getPresentedUserMessageText(message);
    expect(presented).toBe('Review the attachment Attached file: notes.txtAttached file');
    expect(presented).not.toContain('aGVsbG8=');
  });

  it('keeps a legacy inline file block in its authored position, as the daemon serves it', () => {
    const legacy = user('');
    legacy.contentBlocks = [
      { id: 'b1', type: 'file', data: 'aGVsbG8=', mimeType: 'text/plain', fileName: 'notes.txt' },
      { type: 'text', text: ' is the file; ' },
      { id: 'b3', type: 'file', data: 'aGVsbG8=', mimeType: 'text/plain', fileName: 'x.csv' },
      { type: 'text', text: ' too.' },
    ];
    // The same row as the daemon serves it (degrade_inline_file_blocks).
    const served = user('');
    served.contentBlocks = [
      { id: 'b1', type: 'text', text: 'Attached file: notes.txt' },
      { type: 'text', text: ' is the file; ' },
      { id: 'b3', type: 'text', text: 'Attached file: x.csv' },
      { type: 'text', text: ' too.' },
    ];

    expect(getPresentedUserMessageText(legacy)).toBe(
      'Attached file: notes.txt is the file; Attached file: x.csv too.',
    );
    expect(getPresentedUserMessageText(legacy)).toBe(getPresentedUserMessageText(served));
  });

  it('presents a legacy inline file block alone as attached-file text', () => {
    const message = user('');
    message.contentBlocks = [
      { type: 'file', data: 'aGVsbG8=', mimeType: 'text/plain', fileName: 'notes.txt' },
    ];

    expect(getPresentedUserMessageText(message)).toBe('Attached file: notes.txt');
  });

  it('leaves attachment-reference file blocks out of the presented text', () => {
    const message = user('Review the attachment');
    message.contentBlocks!.push({ type: 'file', attachmentId: 'attachment-1', fileName: 'a.txt' });

    expect(getPresentedUserMessageText(message)).toBe('Review the attachment');
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
    const attribution = { kind: 'chief' as const, fromAgentId: 'agent-chief', rawName: '' };
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

  it('uses Chief attribution metadata to strip an exact sender header', () => {
    const header = '[MESSAGE FROM AGENT Chief of Staff (agent-chief-primary)]';
    const message = agentMessage(`${header}\n\nReview the workspace.`, {
      type: 'chief_message',
      fromAgentId: 'agent-chief-primary',
      fromAgentName: 'Chief of Staff',
    });

    expect(getPresentedUserMessageText(message)).toBe('Review the workspace.');
  });
});

// PROTOCOL §5.5 collaborator sender preamble, exactly as intentd prepends it
// (v1 golden `golden_collaborator_sender_preamble`, intentd#1987).
const GUEST_AUTHOR = {
  principalId: 'principal-guest',
  login: 'octocat',
  displayName: 'The Octocat',
  avatarUrl: null,
};
const GUEST_PREAMBLE =
  'Message from @octocat (The Octocat), a collaborator (guest) of this workspace — not the workspace owner.';

function guestMessage(
  text: string,
  overrides: Partial<AgentMessage> & { author?: AgentMessage['author'] | null } = {},
): AgentMessage {
  const { author, ...rest } = overrides;
  return {
    id: 'guest-message',
    role: 'user',
    timestamp: '2026-08-17T05:00:00Z',
    contentBlocks: [{ type: 'text', text }],
    metadata: { fromPrincipalId: GUEST_AUTHOR.principalId },
    ...(author === null ? {} : { author: author ?? GUEST_AUTHOR }),
    ...rest,
  } as AgentMessage;
}

describe('buildCollaboratorSenderPreamble', () => {
  it('matches the daemon golden for every name shape', () => {
    expect(buildCollaboratorSenderPreamble('octocat', 'The Octocat', 'p-1')).toBe(GUEST_PREAMBLE);
    expect(buildCollaboratorSenderPreamble('octocat', null, 'p-1')).toBe(
      'Message from @octocat, a collaborator (guest) of this workspace — not the workspace owner.',
    );
    expect(buildCollaboratorSenderPreamble(null, 'The Octocat', 'p-1')).toBe(
      'Message from The Octocat, a collaborator (guest) of this workspace — not the workspace owner.',
    );
    expect(buildCollaboratorSenderPreamble(null, null, 'p-1')).toBe(
      'Message from principal p-1, a collaborator (guest) of this workspace — not the workspace owner.',
    );
  });

  it('collapses control characters and whitespace runs like the daemon', () => {
    expect(buildCollaboratorSenderPreamble('evil\nlogin', '  \n', 'p-1')).toBe(
      'Message from @evil login, a collaborator (guest) of this workspace — not the workspace owner.',
    );
    expect(buildCollaboratorSenderPreamble('a\t\u0000b', 'Two  Words\u00a0Here', 'p-1')).toBe(
      'Message from @a b (Two Words Here), a collaborator (guest) of this workspace — not the workspace owner.',
    );
  });
});

describe('collaborator sender preamble presentation', () => {
  it('drops the exact preamble from a guest row without mutating stored content', () => {
    const message = guestMessage(`${GUEST_PREAMBLE}\n\nPlease review the diff.`);
    const snapshot = structuredClone(message);

    expect(getCollaboratorSenderAttribution(message)).toEqual({
      author: GUEST_AUTHOR,
      preamble: GUEST_PREAMBLE,
    });
    expect(getPresentedUserMessageText(message)).toBe('Please review the diff.');
    expect(message).toEqual(snapshot);
  });

  it('never qualifies a row authored by the workspace owner, even when its first line is the exact preamble', () => {
    const text = `${GUEST_PREAMBLE}\n\nI typed this myself.`;
    const ownerRow = guestMessage(text, {
      author: { ...GUEST_AUTHOR, principalId: 'principal-owner' },
      metadata: { fromPrincipalId: 'principal-owner' },
    });

    expect(getCollaboratorSenderAttribution(ownerRow, 'principal-owner')).toBeNull();
    expect(getPresentedUserMessageText(ownerRow, 'principal-owner')).toBe(text);
    // The same row from a guest principal still qualifies against that owner id.
    const guestRow = guestMessage(text);
    expect(getCollaboratorSenderAttribution(guestRow, 'principal-owner')).not.toBeNull();
    expect(getPresentedUserMessageText(guestRow, 'principal-owner')).toBe('I typed this myself.');
    // Without the workspace at hand the owner exclusion is not applied.
    expect(getCollaboratorSenderAttribution(ownerRow)).not.toBeNull();
  });

  it('consumes only the preamble and its one blank line, never body whitespace', () => {
    expect(getPresentedUserMessageText(guestMessage(GUEST_PREAMBLE))).toBe('');
    expect(getPresentedUserMessageText(guestMessage(`${GUEST_PREAMBLE}\n\n    indented`))).toBe(
      '    indented',
    );
    expect(getPresentedUserMessageText(guestMessage(`${GUEST_PREAMBLE}\n\n\nextra blank`))).toBe(
      '\nextra blank',
    );
  });

  it('rebuilds the preamble from the login-only and principal-only projections', () => {
    const loginOnly = { ...GUEST_AUTHOR, displayName: null };
    const text = `${buildCollaboratorSenderPreamble('octocat', null, 'principal-guest')}\n\nHi`;
    expect(getPresentedUserMessageText(guestMessage(text, { author: loginOnly }))).toBe('Hi');

    const gone = {
      principalId: 'principal-guest',
      login: null,
      displayName: null,
      avatarUrl: null,
    };
    const bare = `${buildCollaboratorSenderPreamble(null, null, 'principal-guest')}\n\nHi`;
    expect(getPresentedUserMessageText(guestMessage(bare, { author: gone }))).toBe('Hi');
  });

  it('keeps owner rows and user-typed lookalikes byte-identical', () => {
    // An owner row: no preamble was ever prepended.
    expect(getPresentedUserMessageText(guestMessage('Ship it'))).toBe('Ship it');
    // A first line that names a different sender than the row's projection.
    const other = `${buildCollaboratorSenderPreamble('someone', 'Else', 'p-9')}\n\nbody`;
    expect(getCollaboratorSenderAttribution(guestMessage(other))).toBeNull();
    expect(getPresentedUserMessageText(guestMessage(other))).toBe(other);
    // Almost the daemon text, but not byte-exact.
    const nearMiss = `${GUEST_PREAMBLE.slice(0, -1)}\n\nbody`;
    expect(getPresentedUserMessageText(guestMessage(nearMiss))).toBe(nearMiss);
    // The exact text, but not at the start of the content.
    const quoted = `Quoting:\n${GUEST_PREAMBLE}\n\nbody`;
    expect(getPresentedUserMessageText(guestMessage(quoted))).toBe(quoted);
  });

  it('never strips without the serve-time author projection (older daemon / optimistic row)', () => {
    const text = `${GUEST_PREAMBLE}\n\nbody`;
    expect(getCollaboratorSenderAttribution(guestMessage(text, { author: null }))).toBeNull();
    expect(getPresentedUserMessageText(guestMessage(text, { author: null }))).toBe(text);
  });

  it('leaves agent-to-agent rows to the A2A header strip', () => {
    // A2A metadata wins: the row is not human-authored, so the guest
    // projection is ignored even when the content starts with the preamble.
    const a2a = guestMessage(`${A2A_HEADER}\n\nbody`, {
      metadata: {
        type: 'agent_message',
        fromAgentId: 'agent-1234',
        fromAgentName: 'Research Agent',
      },
    });
    expect(getCollaboratorSenderAttribution(a2a)).toBeNull();
    expect(getPresentedUserMessageText(a2a)).toBe('body');

    const lookalike = guestMessage(`${GUEST_PREAMBLE}\n\nbody`, {
      metadata: {
        type: 'agent_message',
        fromAgentId: 'agent-1234',
        fromAgentName: 'Research Agent',
      },
    });
    expect(getPresentedUserMessageText(lookalike)).toBe(`${GUEST_PREAMBLE}\n\nbody`);
  });

  it('strips the preamble alongside a trailing dequeue-wait note', () => {
    const message = guestMessage(`${GUEST_PREAMBLE}\n\nShip it\n\n${WAIT_NOTE}`, {
      metadata: {
        fromPrincipalId: GUEST_AUTHOR.principalId,
        queueInfo: { queuedAt: '2026-08-17T05:00:00.123456Z', waitedMs: 67_000 },
      },
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
