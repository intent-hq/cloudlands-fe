/** @vitest-environment jsdom */
import { expect, it } from 'vitest';
import { processHTMLToMarkdown, processMarkdownToHTML } from '$lib/utils/markdown-processor';

it('records why region serialization is not an exact source-preserving write contract', async () => {
  const source = 'An **untouched** paragraph.\n\n\n\nAnother paragraph.\n';
  const roundTrip = processHTMLToMarkdown(await processMarkdownToHTML(source));
  expect(roundTrip).toContain('An **untouched** paragraph.');
  expect(roundTrip).toContain('Another paragraph.');
  expect(roundTrip).not.toBe(source);
  // A real partial-write implementation must retain untouched source slices;
  // sending serialized regions cannot promise exact source preservation.
});
