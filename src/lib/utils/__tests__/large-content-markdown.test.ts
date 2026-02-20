/**
 * @vitest-environment jsdom
 *
 * Large content tests — exercises the worker pipeline path.
 *
 * The markdown processor uses a different code path for content > 5000 chars
 * (LARGE_CONTENT_THRESHOLD), offloading work to a Web Worker. In the test
 * environment (jsdom), the Worker constructor fails and the code falls back
 * to main-thread processing, but the branching logic and all transforms
 * (normalize, legacy syntax, marked.parse, anchor conversion, mention injection,
 * sanitization) still run through the large-content path.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  processMarkdownToHTML,
  processHTMLToMarkdown,
  clearMarkdownCache,
} from '../markdown-processor';

// Helper: generate markdown content that exceeds the 5000-char threshold
function generateLargeMarkdown(options?: {
  withAnchors?: boolean;
  withTaskLists?: boolean;
  withLegacySyntax?: boolean;
  withHeadings?: boolean;
}): string {
  const sections: string[] = [];
  const opts = {
    withAnchors: false,
    withTaskLists: false,
    withLegacySyntax: false,
    withHeadings: true,
    ...options,
  };

  // Generate enough sections to exceed 5000 chars
  for (let i = 0; i < 30; i++) {
    if (opts.withHeadings) {
      if (opts.withAnchors && i % 5 === 0) {
        sections.push(
          `## <!--anchor:cmt-${i}:start-->Section ${i} Title<!--anchor:cmt-${i}:end-->`,
        );
      } else {
        sections.push(`## Section ${i}`);
      }
    }

    sections.push(
      `This is paragraph ${i} with some content. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
    );

    if (opts.withTaskLists && i % 3 === 0) {
      sections.push(`- [ ] Task item ${i}-a`);
      sections.push(`- [x] Task item ${i}-b completed`);
      sections.push(`- [ ] Task item ${i}-c`);
    }

    if (opts.withLegacySyntax && i % 7 === 0) {
      sections.push(`@@@task\n# Task Block ${i}\nSome task content.\n@@@`);
    }

    sections.push(''); // blank line between sections
  }

  return sections.join('\n');
}

describe('Large Content Processing', () => {
  beforeEach(() => {
    // Clear cache so each test processes fresh content
    clearMarkdownCache();
  });

  it('should process large plain markdown (>5000 chars) correctly', async () => {
    const markdown = generateLargeMarkdown();
    expect(markdown.length).toBeGreaterThan(5000);

    const html = await processMarkdownToHTML(markdown);

    // Verify basic structure is preserved
    expect(html).toContain('<h2>');
    expect(html).toContain('Section 0');
    expect(html).toContain('Section 29');
    expect(html).toContain('Lorem ipsum');
    expect(html).toContain('<p>');
  });

  it('should process large content with comment anchors', async () => {
    const markdown = generateLargeMarkdown({ withAnchors: true });
    expect(markdown.length).toBeGreaterThan(5000);

    const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

    // Anchors should be converted from HTML comments to span elements
    expect(html).toContain('data-anchor-id="cmt-0:start"');
    expect(html).toContain('data-anchor-type="start"');
    expect(html).toContain('data-comment-id="cmt-0"');
    expect(html).toContain('data-anchor-id="cmt-0:end"');
    expect(html).toContain('data-anchor-type="end"');

    // The original HTML comments should NOT remain
    expect(html).not.toContain('<!--anchor:');

    // Heading text should still be present
    expect(html).toContain('Section 0 Title');
  });

  it('should process large content with task lists', async () => {
    const markdown = generateLargeMarkdown({ withTaskLists: true });
    expect(markdown.length).toBeGreaterThan(5000);

    const html = await processMarkdownToHTML(markdown);

    // Task list items should be rendered
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-type="taskItem"');
    expect(html).toContain('data-checked="false"');
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('Task item 0-a');
    expect(html).toContain('Task item 0-b completed');
  });

  it('should process large content with legacy @@@task syntax', async () => {
    const markdown = generateLargeMarkdown({ withLegacySyntax: true });
    expect(markdown.length).toBeGreaterThan(5000);

    const html = await processMarkdownToHTML(markdown);

    // Legacy @@@task blocks should be converted to task blocks
    expect(html).toContain('data-type="task-block"');
    // The @@@ delimiters should not appear in output
    expect(html).not.toContain('@@@task');
    expect(html).not.toContain('@@@');
  });

  it('should process large content with all features combined', async () => {
    const markdown = generateLargeMarkdown({
      withAnchors: true,
      withTaskLists: true,
      withLegacySyntax: true,
    });
    expect(markdown.length).toBeGreaterThan(5000);

    const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

    // All features should work together
    expect(html).toContain('data-anchor-id=');
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-type="task-block"');
    expect(html).toContain('<h2>');
    expect(html).not.toContain('<!--anchor:');
    expect(html).not.toContain('@@@');
  });

  it('should produce consistent output for large content across multiple calls', async () => {
    const markdown = generateLargeMarkdown({ withAnchors: true, withTaskLists: true });
    expect(markdown.length).toBeGreaterThan(5000);

    const html1 = await processMarkdownToHTML(markdown, { preserveAnchors: true });
    // Clear cache to force re-processing
    clearMarkdownCache();
    const html2 = await processMarkdownToHTML(markdown, { preserveAnchors: true });

    expect(html1).toBe(html2);
  });

  it('should round-trip large content through HTML and back to markdown', async () => {
    const markdown = generateLargeMarkdown({ withTaskLists: true });
    expect(markdown.length).toBeGreaterThan(5000);

    const html = await processMarkdownToHTML(markdown);
    const roundTripped = processHTMLToMarkdown(html);

    // Key content should survive the round trip
    expect(roundTripped).toContain('Section 0');
    expect(roundTripped).toContain('Section 29');
    expect(roundTripped).toContain('Lorem ipsum');
    expect(roundTripped).toContain('- [ ] Task item 0-a');
    expect(roundTripped).toContain('- [x] Task item 0-b completed');
  });
});
