import { expect, it } from 'vitest';
import { storeDenseMarkdownFixture } from './__tests__/store-dense-markdown-fixture';
import { nativeFixtureEditor } from './__tests__/canonical-table-fixture';
import { projectNoteWindow } from './note-window-projection';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { NOTE_WINDOW_LIMITS } from './note-window-reader';

it('renders the real dense Store window without exhausting the shared request budget', async () => {
  const fixture = storeDenseMarkdownFixture();
  const window = await fixture.read();
  const editor = nativeFixtureEditor(projectNoteWindow(window).content);
  const control = nativeFixtureEditor(await processMarkdownToHTML(window.text));
  try {
    expect(window.sourceLength).toBe(2_000_000);
    expect(window.range.start).toBe(0);
    expect(window.range.end).toBeGreaterThan(93); // Includes heading, strong, emphasis and code.
    expect(window.text).toBe(fixture.identity.text.slice(0, window.range.end));
    expect(editor.getJSON()).toEqual(control.getJSON());
    expect(window.cost.requests).toBe(fixture.requests.length);
    expect(window.cost.requests).toBeLessThanOrEqual(NOTE_WINDOW_LIMITS.requests);
    expect(window.cost.sourceBytes).toBeLessThanOrEqual(NOTE_WINDOW_LIMITS.sourceBytes);
    expect(window.cost.canonicalBytes).toBeLessThanOrEqual(NOTE_WINDOW_LIMITS.canonicalBytes);
    expect(fixture.requests.every((q) => q.maxWireBytes === NOTE_WINDOW_LIMITS.wireBytes)).toBe(
      true,
    );
    expect(fixture.requests.every((q) => q.kind !== 'metadata' || !!q.ref)).toBe(true);
  } finally {
    editor.destroy();
    control.destroy();
  }
});

it('cancels between dense admission attempts before requesting another page', async () => {
  let current = true;
  const fixture = storeDenseMarkdownFixture((page) => {
    if (page.kind === 'noteContextPage') current = false;
    return page;
  });
  await expect(fixture.read(() => current)).rejects.toThrow(/superseded/);
  expect(fixture.requests.map((q) => q.kind)).toEqual(['source', 'context']);
});

it('rejects a changed revision in a smaller retry instead of rendering mixed content', async () => {
  const fixture = storeDenseMarkdownFixture((page, q) =>
    q.kind === 'source' && q.maxSourceBytes! < NOTE_WINDOW_LIMITS.requestSourceBytes
      ? { ...page, sourceRevision: 'changed-revision' }
      : page,
  );
  await expect(fixture.read()).rejects.toThrow(/revision|snapshot/i);
  expect(fixture.requests.length).toBeLessThan(NOTE_WINDOW_LIMITS.requests);
});
