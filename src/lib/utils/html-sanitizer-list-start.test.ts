import { expect, it } from 'vitest';
import { sanitizeMarkdownHTML } from './html-sanitizer';
import { processMarkdownToHTML } from './markdown-processor';

for (const start of [0, 17, 27]) {
  it(`preserves ordered-list start ${start} through Markdown sanitization`, async () => {
    const source = `${start}. parent\n    - child\n${start + 1}. after`;
    const element = document.createElement('div');
    element.innerHTML = await processMarkdownToHTML(source);
    expect(element.querySelector('ol')?.getAttribute('start')).toBe(String(start));
    expect(element.querySelector('ol > li > ul > li')?.textContent?.trim()).toBe('child');
  });
}

it('preserves flat ordered numbering while removing unsafe attributes, elements and URLs', () => {
  const element = document.createElement('div');
  element.innerHTML = sanitizeMarkdownHTML(
    '<ol start="817" onclick="alert(1)"><li><a href="javascript:alert(1)">item</a><script>alert(1)</script></li></ol>',
  );
  expect(element.querySelector('ol')?.getAttribute('start')).toBe('817');
  expect(element.querySelector('ol')?.hasAttribute('onclick')).toBe(false);
  expect(element.querySelector('script')).toBeNull();
  expect(element.querySelector('a')?.hasAttribute('href')).toBe(false);
});
