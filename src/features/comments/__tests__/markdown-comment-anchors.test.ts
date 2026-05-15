/**
 * Tests for comment anchor interactions with markdown syntax
 *
 * This test suite verifies that comment anchors don't break markdown syntax
 * elements like headings, lists, code blocks, etc.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  processMarkdownToHTML,
  processHTMLToMarkdown,
} from '$lib/utils/markdown-processor';

describe('Comment Anchors and Markdown Syntax', () => {
  describe('Heading Syntax', () => {
    it('should preserve H1 heading when anchors are inside heading text', async () => {
      const markdown = '# <!--anchor:cmt-1:start-->Syncthing Prototype<!--anchor:cmt-1:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      // Check if the heading is preserved as an H1 element
      expect(html).toContain('<h1');
      expect(html).toContain('Syncthing Prototype');
    });

    it('should preserve H2 heading when anchors wrap entire heading', async () => {
      const markdown = '<!--anchor:cmt-1:start-->## Goals<!--anchor:cmt-1:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      // Check if the heading is preserved as an H2 element
      expect(html).toContain('<h2');
      expect(html).toContain('Goals');
    });

    it('should preserve H2 heading when anchors are after heading marker', async () => {
      const markdown = '## <!--anchor:cmt-1:start-->Discussion<!--anchor:cmt-1:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      // Check if the heading is preserved as an H2 element
      expect(html).toContain('<h2');
      expect(html).toContain('Discussion');
    });

    it('should preserve heading when anchors are on separate lines', async () => {
      const markdown = '<!--anchor:cmt-1:start-->\n# Syncthing Prototype\n<!--anchor:cmt-1:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      // Check if the heading is preserved as an H1 element
      expect(html).toContain('<h1');
      expect(html).toContain('Syncthing Prototype');
    });
  });

  describe('Round-trip Preservation', () => {
    it('should preserve heading syntax through markdown -> HTML -> markdown round-trip', async () => {
      const originalMarkdown = '# Syncthing Prototype\n\n## Goals\n\n## Discussion';

      // Convert to HTML
      const html = await processMarkdownToHTML(originalMarkdown);

      // Convert back to markdown
      const resultMarkdown = processHTMLToMarkdown(html);

      // Should preserve heading markers
      expect(resultMarkdown).toContain('# Syncthing Prototype');
      expect(resultMarkdown).toContain('## Goals');
      expect(resultMarkdown).toContain('## Discussion');
    });

    it('should preserve heading with anchors through round-trip', async () => {
      const originalMarkdown =
        '# <!--anchor:cmt-1:start-->Syncthing Prototype<!--anchor:cmt-1:end-->';

      // Convert to HTML
      const html = await processMarkdownToHTML(originalMarkdown, { preserveAnchors: true });

      // Convert back to markdown
      const resultMarkdown = processHTMLToMarkdown(html, { preserveAnchors: true });

      // Should preserve heading marker
      expect(resultMarkdown).toContain('# ');
      expect(resultMarkdown).toContain('Syncthing Prototype');
      expect(resultMarkdown).toContain('<!--anchor:cmt-1:start-->');
      expect(resultMarkdown).toContain('<!--anchor:cmt-1:end-->');
    });
  });

  describe('List Syntax', () => {
    it('should preserve bullet list when anchors are inside list item', async () => {
      const markdown = '- <!--anchor:cmt-1:start-->First item<!--anchor:cmt-1:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      expect(html).toContain('<ul');
      expect(html).toContain('<li');
      expect(html).toContain('First item');
    });

    it('should preserve numbered list when anchors wrap list marker', async () => {
      const markdown = '<!--anchor:cmt-1:start-->1. First item<!--anchor:cmt-1:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      expect(html).toContain('<ol');
      expect(html).toContain('<li');
      expect(html).toContain('First item');
    });
  });

  describe('Code Block Syntax', () => {
    it('should preserve code block when anchors are outside', async () => {
      const markdown = '<!--anchor:cmt-1:start-->```\nconst x = 1;\n```<!--anchor:cmt-1:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      expect(html).toContain('<pre');
      expect(html).toContain('const x = 1');
    });
  });

  describe('Inline Code Syntax', () => {
    it('should preserve inline code when anchors are outside', async () => {
      const markdown = 'This is <!--anchor:cmt-1:start-->`code`<!--anchor:cmt-1:end--> here';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      expect(html).toContain('<code');
      expect(html).toContain('code');
    });
  });

  describe('Blockquote Syntax', () => {
    it('should preserve blockquote when anchors are inside', async () => {
      const markdown = '> <!--anchor:cmt-1:start-->This is a quote<!--anchor:cmt-1:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      expect(html).toContain('<blockquote');
      expect(html).toContain('This is a quote');
    });
  });

  describe('Anchor Placement Validation', () => {
    it('should detect when anchors break heading syntax', async () => {
      const testCases = [
        {
          markdown: '# <!--anchor:cmt-1:start-->Title<!--anchor:cmt-1:end-->',
          description: 'anchors inside heading text',
        },
        {
          markdown: '<!--anchor:cmt-1:start-->## Title<!--anchor:cmt-1:end-->',
          description: 'anchors wrapping entire heading',
        },
        {
          markdown: '## <!--anchor:cmt-1:start-->Title<!--anchor:cmt-1:end-->',
          description: 'anchors after heading marker',
        },
      ];

      for (const testCase of testCases) {
        const html = await processMarkdownToHTML(testCase.markdown, { preserveAnchors: true });
        const hasHeading = html.includes('<h1') || html.includes('<h2') || html.includes('<h3');

        console.log(`Test case: ${testCase.description}`);
        console.log(`  Markdown: ${testCase.markdown}`);
        console.log(`  HTML: ${html.substring(0, 200)}`);
        console.log(`  Has heading: ${hasHeading}`);
      }
    });
  });
});
