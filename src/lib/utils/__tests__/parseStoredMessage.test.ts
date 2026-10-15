import { expect, it } from 'vitest';
import { getStoredMessageText, parseStoredMessage } from '../parseStoredMessage';

it('preserves the source edit parser defaults while exposing exact authored clipboard text', () => {
  const body = '\n\n  café 你好\n\n```ts\nvalue()\n```\n\n';
  const source =
    '[Currently viewing file: src/a.ts]\n```ts\nprivate context\n```\n\n' +
    '[Currently viewing note: Plan]\n\n' +
    body;
  expect(getStoredMessageText(source)).toBe(body);
  expect(parseStoredMessage(source)).toMatchObject({
    userMessage: body.trim(),
    contextItems: [
      { type: 'file', path: 'src/a.ts', content: 'private context' },
      { type: 'note', label: 'Plan' },
    ],
  });
});

it('leaves ordinary Markdown and literal context syntax outside the prefix untouched', () => {
  const text = '  Keep this\n\n```text\n[Currently viewing note: Authored]\n```\n';
  expect(getStoredMessageText(text)).toBe(text);
  expect(parseStoredMessage(text)).toEqual({ contextItems: [], userMessage: text.trim() });
});
