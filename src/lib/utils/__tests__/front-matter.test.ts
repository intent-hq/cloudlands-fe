/**
 * @vitest-environment jsdom
 */
import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  extractFrontMatter,
  processMarkdownToHTML,
} from '../markdown-processor';

describe('extractFrontMatter', () => {
  it('should extract YAML front matter from a document', () => {
    const content = '---\ntitle: Hello\ndate: 2024-01-01\n---\n# My Document\n\nSome content.';
    const { frontMatter, body } = extractFrontMatter(content);
    expect(frontMatter).toBe('---\ntitle: Hello\ndate: 2024-01-01\n---\n');
    expect(body).toBe('# My Document\n\nSome content.');
  });

  it('should return null frontMatter when none exists', () => {
    const content = '# Just a heading\n\nSome content.';
    const { frontMatter, body } = extractFrontMatter(content);
    expect(frontMatter).toBeNull();
    expect(body).toBe(content);
  });

  it('should not match --- that is not at the start of the document', () => {
    const content = 'Some content\n---\ntitle: Hello\n---\nMore content.';
    const { frontMatter, body } = extractFrontMatter(content);
    expect(frontMatter).toBeNull();
    expect(body).toBe(content);
  });

  it('should handle front matter with empty values', () => {
    const content = '---\ntitle:\ntags:\n---\nContent here.';
    const { frontMatter, body } = extractFrontMatter(content);
    expect(frontMatter).toBe('---\ntitle:\ntags:\n---\n');
    expect(body).toBe('Content here.');
  });

  it('should handle front matter at end of file (no trailing content)', () => {
    const content = '---\ntitle: Only metadata\n---';
    const { frontMatter, body } = extractFrontMatter(content);
    expect(frontMatter).toBe('---\ntitle: Only metadata\n---');
    expect(body).toBe('');
  });

  it('should handle front matter with Windows-style line endings', () => {
    const content = '---\r\ntitle: Hello\r\n---\r\nContent.';
    const { frontMatter, body } = extractFrontMatter(content);
    expect(frontMatter).not.toBeNull();
    expect(body).toContain('Content.');
  });
});

describe('YAML Front Matter - Markdown Processing', () => {
  it('should not corrupt front matter delimiters during markdown processing', async () => {
    const markdown = '---\ntitle: Test\n---\n# Heading\n\nParagraph content.';
    const html = await processMarkdownToHTML(markdown);
    // The front matter should be stripped — no <hr> from the --- delimiters
    expect(html).not.toContain('<hr');
    // The actual content should still be rendered
    expect(html).toContain('Heading');
    expect(html).toContain('Paragraph content');
  });

  it('should not turn front matter YAML keys into headings', async () => {
    const markdown = '---\ntitle: My Page\nauthor: Jane\n---\n\nHello world.';
    const html = await processMarkdownToHTML(markdown);
    // YAML keys should not appear as rendered content
    expect(html).not.toContain('title:');
    expect(html).not.toContain('author:');
    expect(html).toContain('Hello world');
  });

  it('should process markdown without front matter normally', async () => {
    const markdown = '# Normal Heading\n\nJust regular content.';
    const html = await processMarkdownToHTML(markdown);
    expect(html).toContain('Normal Heading');
    expect(html).toContain('Just regular content');
  });

  it('should handle --- horizontal rules that are NOT front matter', async () => {
    // A --- in the middle of a doc is a horizontal rule, not front matter
    const markdown = 'Some content\n\n---\n\nMore content.';
    const html = await processMarkdownToHTML(markdown);
    expect(html).toContain('<hr');
    expect(html).toContain('Some content');
    expect(html).toContain('More content');
  });
});

