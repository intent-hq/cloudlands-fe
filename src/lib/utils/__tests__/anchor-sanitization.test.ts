/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { processHTMLToMarkdown } from '../markdown-processor';

describe('Anchor Sanitization', () => {
  it('should preserve anchor spans through sanitization', () => {
    // This is the HTML that TipTap generates with comment anchors
    const html =
      '<p>Please <span data-anchor-id="56809e99-5645-40e7-ae9a-b88b65ee1a1c:start" data-anchor-type="start" data-comment-id="56809e99-5645-40e7-ae9a-b88b65ee1a1c" style="display:none"></span>add a comment<span data-anchor-id="56809e99-5645-40e7-ae9a-b88b65ee1a1c:end" data-anchor-type="end" data-comment-id="56809e99-5645-40e7-ae9a-b88b65ee1a1c" style="display:none"></span> in this sentence</p>';

    const markdown = processHTMLToMarkdown(html, { preserveAnchors: true });

    // Should contain the HTML comment anchors
    expect(markdown).toContain('<!--anchor:56809e99-5645-40e7-ae9a-b88b65ee1a1c:start-->');
    expect(markdown).toContain('<!--anchor:56809e99-5645-40e7-ae9a-b88b65ee1a1c:end-->');
    expect(markdown).toContain('add a comment');
  });

  it('should handle partial anchor deletion scenario', () => {
    // Scenario: User deletes "comment in this sentence" leaving only "add a"
    // The end anchor should be deleted but start anchor should remain
    const htmlBefore =
      '<p>Please <span data-anchor-id="test:start" data-anchor-type="start" data-comment-id="test" style="display:none"></span>add a comment<span data-anchor-id="test:end" data-anchor-type="end" data-comment-id="test" style="display:none"></span> in this sentence</p>';

    const markdownBefore = processHTMLToMarkdown(htmlBefore, { preserveAnchors: true });
    expect(markdownBefore).toContain('<!--anchor:test:start-->');
    expect(markdownBefore).toContain('<!--anchor:test:end-->');

    // After user deletes "comment in this sentence"
    const htmlAfter =
      '<p>Please <span data-anchor-id="test:start" data-anchor-type="start" data-comment-id="test" style="display:none"></span>add a</p>';

    const markdownAfter = processHTMLToMarkdown(htmlAfter, { preserveAnchors: true });

    // Should have start anchor but not end anchor
    expect(markdownAfter).toContain('<!--anchor:test:start-->');
    expect(markdownAfter).not.toContain('<!--anchor:test:end-->');
    expect(markdownAfter).toContain('add a');
  });

  it('should handle complete anchor deletion scenario', () => {
    // Scenario: User deletes all anchored text
    const htmlBefore =
      '<p>Please <span data-anchor-id="test:start" data-anchor-type="start" data-comment-id="test" style="display:none"></span>add a comment<span data-anchor-id="test:end" data-anchor-type="end" data-comment-id="test" style="display:none"></span> in this sentence</p>';

    // After user deletes "add a comment"
    const htmlAfter = '<p>Please  in this sentence</p>';

    const markdownAfter = processHTMLToMarkdown(htmlAfter, { preserveAnchors: true });

    // Should have no anchors
    expect(markdownAfter).not.toContain('<!--anchor:test:start-->');
    expect(markdownAfter).not.toContain('<!--anchor:test:end-->');
    expect(markdownAfter).toBe('Please  in this sentence');
  });
});
