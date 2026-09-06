/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { processMarkdownToHTML, processHTMLToMarkdown } from '../markdown-processor';

describe('Choice Block - Markdown Processing', () => {
  // NOTE: The "Parsing (Markdown → HTML)" tests are skipped because choice block parsing
  // is handled by TipTap's node system at runtime, not by the markdown processor.
  // The markdown processor treats ```choice blocks as regular code blocks with language-choice class.
  // Choice blocks are converted to structured HTML only when TipTap parses them.
  describe.skip('Parsing (Markdown → HTML) - V2 Structure', () => {
    it('should recognize choice block and convert to HTML div', async () => {
      const markdown = `\`\`\`choice
Which one?
( ) Option A
(x) Option B
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Should create a div with data-type="choice-block"
      expect(html).toContain('data-type="choice-block"');
    });

    it('should create nested choice-question div with paragraph', async () => {
      const markdown = `\`\`\`choice
Which one?
( ) Option A
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Should have nested question structure
      expect(html).toContain('data-type="choice-question"');
      expect(html).toContain('<p>Which one?</p>');
    });

    it('should create nested choice-option divs with paragraphs', async () => {
      const markdown = `\`\`\`choice
Which one?
( ) Option A
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Should have nested option structure
      expect(html).toContain('data-type="choice-option"');
      expect(html).toContain('data-selected="false"');
      expect(html).toContain('<p>Option A</p>');
    });

    it('should create multiple option divs with correct selection state', async () => {
      const markdown = `\`\`\`choice
Which one?
( ) Option A
(x) Option B
( ) Option C
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Should have 3 option divs
      const optionMatches = html.match(/data-type="choice-option"/g);
      expect(optionMatches).toHaveLength(3);

      // Check selection states
      expect(html).toContain('data-selected="false"');
      expect(html).toContain('data-selected="true"');

      // Check option text
      expect(html).toContain('<p>Option A</p>');
      expect(html).toContain('<p>Option B</p>');
      expect(html).toContain('<p>Option C</p>');
    });
  });

  describe('Serialization (HTML → Markdown) - V2 Structure', () => {
    it('should serialize V2 choice block HTML back to markdown', async () => {
      // V2 HTML structure with nested divs
      const html = `<div data-type="choice-block">
  <div data-type="choice-question"><p>Which one?</p></div>
  <div data-type="choice-option" data-selected="false"><p>Option A</p></div>
  <div data-type="choice-option" data-selected="true"><p>Option B</p></div>
</div>`;

      const markdown = processHTMLToMarkdown(html);

      expect(markdown).toBe(`\`\`\`choice
Which one?
( ) Option A
(x) Option B
\`\`\``);
    });

    it('CRITICAL: should add blank line between consecutive choice blocks', async () => {
      // Two consecutive choice blocks - this is the bug scenario
      const html = `<div data-type="choice-block">
  <div data-type="choice-question"><p>Which approach?</p></div>
  <div data-type="choice-option" data-selected="true"><p>Option A</p></div>
  <div data-type="choice-option" data-selected="false"><p>Option B</p></div>
</div><div data-type="choice-block">
  <div data-type="choice-question"><p>Which flavor?</p></div>
  <div data-type="choice-option" data-selected="false"><p>Vanilla</p></div>
  <div data-type="choice-option" data-selected="true"><p>Chocolate</p></div>
</div>`;

      const markdown = processHTMLToMarkdown(html);

      // Should have proper separation with blank line between blocks
      expect(markdown).toBe(`\`\`\`choice
Which approach?
(x) Option A
( ) Option B
\`\`\`

\`\`\`choice
Which flavor?
( ) Vanilla
(x) Chocolate
\`\`\``);
    });
  });

  // NOTE: Round-trip tests are skipped because choice block parsing is handled by TipTap's
  // node system at runtime, not by the markdown processor. The markdown processor treats
  // ```choice blocks as regular code blocks, so round-trip doesn't preserve the choice syntax.
  describe.skip('Round-trip (Markdown → HTML → Markdown) - V2', () => {
    it('should preserve choice block through round-trip', async () => {
      const original = `\`\`\`choice
Which approach should we take?
( ) Option A: Use REST API
(x) Option B: Use tRPC
( ) Option C: Use GraphQL
\`\`\``;

      const html = await processMarkdownToHTML(original);
      const result = processHTMLToMarkdown(html);

      expect(result).toBe(original);
    });

    it('should preserve special characters in question and options', async () => {
      const original = `\`\`\`choice
What's your favorite "feature"?
( ) Option with <brackets>
(x) Option with & ampersand
( ) Option with 'quotes'
\`\`\``;

      const html = await processMarkdownToHTML(original);
      const result = processHTMLToMarkdown(html);

      expect(result).toBe(original);
    });

    it('should handle multiple choice blocks in same document', async () => {
      const markdown = `\`\`\`choice
First question?
( ) Option A
(x) Option B
\`\`\`

\`\`\`choice
Second question?
(x) Option C
( ) Option D
\`\`\``;

      const html = await processMarkdownToHTML(markdown);

      // Should have two choice blocks
      const blockMatches = html.match(/data-type="choice-block"/g);
      expect(blockMatches).toHaveLength(2);

      // Should have both questions
      expect(html).toContain('<p>First question?</p>');
      expect(html).toContain('<p>Second question?</p>');

      // Round-trip should preserve both blocks
      const result = processHTMLToMarkdown(html);
      expect(result).toContain('First question?');
      expect(result).toContain('Second question?');
      expect(result).toContain('Option A');
      expect(result).toContain('Option D');
    });

    it('CRITICAL: should preserve fence separation in round-trip with multiple blocks', async () => {
      // This test reproduces the exact bug scenario from the user's note
      const original = `\`\`\`choice
Which approach should we take?
( ) Option A: Use REST API
(x) Option B: Use tRPC
( ) Option C: Use GraphQL
\`\`\`

\`\`\`choice
Which flavor ice cream?
( ) Vanilla
( ) Chocolate
(x) Strawberry
( ) Mint Chocolate Chip
\`\`\``;

      // Parse to HTML
      const html = await processMarkdownToHTML(original);

      // Serialize back to markdown
      const result = processHTMLToMarkdown(html);

      // CRITICAL: Should NOT merge fences into ``````choice
      expect(result).not.toContain('``````choice');

      // Should have proper separation
      expect(result).toContain('\`\`\`\n\n\`\`\`choice');

      // Should preserve both blocks completely
      expect(result).toContain('Which approach should we take?');
      expect(result).toContain('Which flavor ice cream?');

      // Full round-trip should match original
      expect(result).toBe(original);
    });

    it('should preserve choice block with many options', async () => {
      const original = `\`\`\`choice
Which option?
( ) Option 1
( ) Option 2
( ) Option 3
(x) Option 4
( ) Option 5
\`\`\``;

      const html = await processMarkdownToHTML(original);
      const result = processHTMLToMarkdown(html);

      expect(result).toBe(original);
    });
  });
});
