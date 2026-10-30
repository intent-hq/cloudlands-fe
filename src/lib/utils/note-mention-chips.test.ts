/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { injectMentionSpans } from './markdown-mention-injector';
import { processHTMLToMarkdown, processMarkdownToHTML } from './markdown-processor';

const NOTE_ID = '3f2a9c1e-7b4d-4e8a-9f10-2c5d6e7f8a9b';
const TITLE = 'Meeting with Andre Oct 30 2026';

function chip(html: string): HTMLElement | null {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container.querySelector('span[data-mention][data-type="note"]');
}

describe('note mention chips rebuilt from @note[...] tokens', () => {
  it('worker injector labels the chip with the saved title and keeps the id', () => {
    const el = chip(injectMentionSpans(`<p>@note[${NOTE_ID}:${TITLE}] next</p>`));
    expect(el?.getAttribute('data-id')).toBe(NOTE_ID);
    expect(el?.textContent).toBe(TITLE);
    expect(el?.parentElement?.textContent).toBe(`${TITLE} next`);
  });

  it('worker injector carries the workspace for a note from another workspace', () => {
    const el = chip(injectMentionSpans(`<p>@note[ws-2/${NOTE_ID}:${TITLE}]</p>`));
    expect(JSON.parse(el?.getAttribute('data-meta') || '{}')).toMatchObject({
      workspaceId: 'ws-2',
      isExternalLink: true,
      isCurrentWorkspace: false,
    });
  });

  it('worker injector decodes HTML entities in the saved title', () => {
    const el = chip(injectMentionSpans('<p>@note[n1:R&amp;D &#39;plan&#x27; &nbsp;x]</p>'));
    expect(el?.textContent).toBe("R&D 'plan' \u00a0x");
  });

  it('note editor round-trip keeps the title instead of showing the id', async () => {
    const md = `See @note[${NOTE_ID}:${TITLE}] now`;
    const html = await processMarkdownToHTML(md);
    const el = chip(html);
    expect(el?.getAttribute('data-id')).toBe(NOTE_ID);
    expect(el?.textContent).toBe(TITLE);
    expect(processHTMLToMarkdown(html).trim()).toBe(md);
  });

  it('note editor round-trip keeps the workspace of a cross-workspace note', async () => {
    const md = `See @note[ws-2/${NOTE_ID}:${TITLE}] now`;
    const html = await processMarkdownToHTML(md);
    expect(chip(html)?.textContent).toBe(TITLE);
    expect(processHTMLToMarkdown(html).trim()).toBe(md);
  });

  it('a note mention inside a table cell survives the note round-trip', async () => {
    const md = `| Item | Note |\n| --- | --- |\n| A | @note[${NOTE_ID}:${TITLE}] |`;
    const html = await processMarkdownToHTML(md);
    expect(chip(html)?.textContent).toBe(TITLE);
    const out = processHTMLToMarkdown(html);
    expect(out).toContain(`@note[${NOTE_ID}:${TITLE}]`);
    const reparsed = await processMarkdownToHTML(out);
    expect(chip(reparsed)?.textContent).toBe(TITLE);
  });
});
