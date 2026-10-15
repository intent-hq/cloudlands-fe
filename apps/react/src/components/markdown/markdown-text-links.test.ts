import { expect, it } from 'vitest';
import { linkifyMarkdownText } from './markdown-text-links';

it('uses source URL boundaries while preserving explicit links, code and text', () => {
  const html =
    '<p>See intent://local/owned/agent/agent-one/message/message-one. <a href="intent://local/note/a">Named note</a> <code>intent://local/note/code</code></p><pre>https://example.invalid/code</pre>';
  const host = document.createElement('div');
  host.innerHTML = linkifyMarkdownText(html);
  expect(
    [...host.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent]),
  ).toEqual([
    [
      'intent://local/owned/agent/agent-one/message/message-one',
      'intent://local/owned/agent/agent-one/message/message-one',
    ],
    ['intent://local/note/a', 'Named note'],
  ]);
  const before = document.createElement('div');
  before.innerHTML = html;
  expect(host.textContent).toBe(before.textContent);
  expect(linkifyMarkdownText(host.innerHTML)).toBe(host.innerHTML);
});

it('creates text-only labels and does not activate unsafe or encoded markup', () => {
  const host = document.createElement('div');
  host.innerHTML = linkifyMarkdownText(
    '<p>&lt;img onerror=evil&gt; javascript:evil https://example.invalid/?a=&quot;x&quot;&amp;b=1</p>',
  );
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelectorAll('a')).toHaveLength(1);
  expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.invalid/?a="x"&b=1');
  expect(host.querySelector('[onerror]')).toBeNull();
});
