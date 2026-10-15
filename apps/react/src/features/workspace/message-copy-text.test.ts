import { expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { getConversationUserText, getCopyableMessageText } from './message-copy-text';
import { buildCollaboratorSenderPreamble } from '$lib/utils/collaborator-sender-attribution';

const base: AgentMessage = {
  id: 'persisted',
  seq: 9,
  role: 'user',
  timestamp: '2026-10-15',
  contentBlocks: [],
};
const markdown =
  '  café 你好 👩‍💻\n\n```ts\nconst value = 1;\n```\n\n[exact link](https://example.test/a)\n';
it('preserves authored Markdown, Unicode, whitespace and legacy aliases, without attachments or metadata', () => {
  const message: AgentMessage = {
    ...base,
    metadata: { contextReferences: [{ hidden: 'do not copy' }] },
    contentBlocks: [
      { type: 'text', text: markdown.slice(0, 9) },
      { type: 'text', content: markdown.slice(9) },
      { type: 'file', fileName: 'secret', data: 'BINARY' },
      { type: 'image', data: 'IMAGE' },
    ],
  };
  const before = structuredClone(message);
  expect(getCopyableMessageText(message)).toBe(markdown);
  expect(message).toEqual(before);
});
it('uses source assistant paragraph separators and excludes thinking and slim tool output', () => {
  expect(
    getCopyableMessageText({
      ...base,
      role: 'assistant',
      contentBlocks: [
        { type: 'text', text: markdown },
        { type: 'thinking', text: 'PRIVATE' },
        { type: 'tool_result', output: 'PARTIAL', outputTruncated: true },
        { type: 'text', content: 'Final paragraph\n' },
      ],
    }),
  ).toBe(markdown + '\n\nFinal paragraph\n');
});
it('uses canonical sender and trailing delivery-note presentation, preserving authored lookalikes', () => {
  const author = { principalId: 'guest', login: 'guest', displayName: 'Guest', avatarUrl: null };
  const prefix = buildCollaboratorSenderPreamble(
    author.login,
    author.displayName,
    author.principalId,
  );
  const message = {
    ...base,
    author,
    contentBlocks: [{ type: 'text' as const, text: prefix + '\n\n' + markdown }],
  };
  expect(getCopyableMessageText(message, 'owner')).toBe(markdown);
  expect(getCopyableMessageText(message, 'guest')).toBe(prefix + '\n\n' + markdown);
  const delivery =
    '[SYSTEM NOTE] This message was queued at 2026-08-17T05:00:00.123456Z and waited 1m 7s before delivery.';
  expect(
    getCopyableMessageText({
      ...base,
      contentBlocks: [{ type: 'text', text: 'Visible\n\n' + delivery }],
    }),
  ).toBe('Visible');
  expect(
    getCopyableMessageText({
      ...base,
      contentBlocks: [{ type: 'text', text: '[SYSTEM NOTE] Authored prose.' }],
    }),
  ).toBe('[SYSTEM NOTE] Authored prose.');
});
it.each([
  { seq: undefined },
  { provisional: true },
  { isStreaming: true },
  { streamingComplete: false },
  { metadata: { streamComplete: false } },
  { metadata: { interrupted: true } },
  { metadata: { finishReason: 'max_tokens' } },
  { role: 'system' },
  { contentBlocks: [] },
  { contentBlocks: [{ type: 'text', text: '' }] },
  { contentBlocks: [{ type: 'text' }] },
  { contentBlocks: [{ type: 'file', data: 'binary' }] },
  { contentBlocks: [{ type: 'code', text: 'unsupported structured code' }] },
])('does not present unavailable or unfinished text as a complete copy: %j', (patch) => {
  expect(
    getCopyableMessageText({
      ...base,
      contentBlocks: [{ type: 'text', text: 'partial' }],
      ...patch,
    } as AgentMessage),
  ).toBeNull();
});

it('excludes canonical hidden context payloads without trimming the authored body', () => {
  const wrapped =
    '[Currently viewing file: src/example.ts]\n```ts\nHIDDEN_CONTEXT_BYTES\n```\n\n' + markdown;
  expect(
    getCopyableMessageText({ ...base, contentBlocks: [{ type: 'text', text: wrapped }] }),
  ).toBe(markdown);
  expect(
    getCopyableMessageText({
      ...base,
      contentBlocks: [{ type: 'text', text: '[Currently viewing note: Plan]\n\n' }],
    }),
  ).toBeNull();
});

it('keeps visible legacy aliases and copied authored leading blank lines aligned', () => {
  const body = '\n\n  keep indented body\n';
  const message = {
    ...base,
    contentBlocks: [
      { type: 'text' as const, content: '[Currently viewing note: Plan]\n\n' + body },
    ],
  };
  expect(getCopyableMessageText(message)).toBe(body);
  expect(getConversationUserText(message)).toBe(body);
});
