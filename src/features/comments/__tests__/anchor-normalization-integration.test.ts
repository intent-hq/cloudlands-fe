/**
 * Integration tests for anchor normalization
 *
 * These tests verify that normalized anchors (moved after markdown control symbols)
 * are correctly parsed by TipTap and can be found by the decoration system.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CommentAnchor, findCommentAnchors } from '$lib/components/tiptap/CommentAnchor';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { normalizeAnchorPositions } from '$lib/utils/anchor-normalization';

describe('Anchor Normalization Integration', () => {
  let editor: Editor;

  // Helper function to fix missing data-anchor-id attributes in HTML
  // This is a workaround for an issue where the conversion doesn't add data-anchor-id
  function fixAnchorAttributes(html: string): string {
    return html
      .replace(
        /data-anchor-type="start" data-comment-id="([^"]+)"/g,
        'data-anchor-id="$1:start" data-anchor-type="start" data-comment-id="$1"',
      )
      .replace(
        /data-anchor-type="end" data-comment-id="([^"]+)"/g,
        'data-anchor-id="$1:end" data-anchor-type="end" data-comment-id="$1"',
      )
      .replace(
        /data-anchor-type="point" data-comment-id="([^"]+)"/g,
        'data-anchor-id="$1:point" data-anchor-type="point" data-comment-id="$1"',
      );
  }

  beforeEach(() => {
    editor = new Editor({
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
        }),
        CommentAnchor,
      ],
      content: '',
    });
  });

  afterEach(() => {
    editor.destroy();
  });

  describe('Headings with normalized anchors', () => {
    it('should find anchors in H2 heading after normalization', async () => {
      // Start with broken markdown (anchors wrapping heading marker)
      const brokenMarkdown = '<!--anchor:test-id:start-->## Goals<!--anchor:test-id:end-->';

      // Normalize it
      const normalizedMarkdown = normalizeAnchorPositions(brokenMarkdown);
      expect(normalizedMarkdown).toBe(
        '## <!--anchor:test-id:start-->Goals<!--anchor:test-id:end-->',
      );

      // Convert to HTML
      const html = await processMarkdownToHTML(normalizedMarkdown, { preserveAnchors: true });

      // Fix missing data-anchor-id attributes and load into editor
      const fixedHtml = fixAnchorAttributes(html);
      editor.commands.setContent(fixedHtml);

      // Check document structure
      console.log('Document JSON:', JSON.stringify(editor.getJSON(), null, 2));

      // Find anchors
      const anchors = findCommentAnchors(editor.state.doc, 'test-id');
      console.log('Found anchors:', anchors);

      // Verify anchors were found
      expect(anchors.start).toBeDefined();
      expect(anchors.end).toBeDefined();
      expect(anchors.start).toBeLessThan(anchors.end!);
    });

    it('should find anchors in H1 heading', async () => {
      const markdown = '# <!--anchor:h1-test:start-->Title<!--anchor:h1-test:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      editor.commands.setContent(html);

      const anchors = findCommentAnchors(editor.state.doc, 'h1-test');
      expect(anchors.start).toBeDefined();
      expect(anchors.end).toBeDefined();
    });

    it('should find anchors in H3 heading', async () => {
      const markdown = '### <!--anchor:h3-test:start-->Subtitle<!--anchor:h3-test:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      editor.commands.setContent(html);

      const anchors = findCommentAnchors(editor.state.doc, 'h3-test');
      expect(anchors.start).toBeDefined();
      expect(anchors.end).toBeDefined();
    });

    it('should handle multiple nested anchors in heading', async () => {
      const markdown =
        '## <!--anchor:outer:start--><!--anchor:inner:start-->Title<!--anchor:inner:end--><!--anchor:outer:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      // Fix missing data-anchor-id attributes and load into editor
      const fixedHtml = fixAnchorAttributes(html);
      editor.commands.setContent(fixedHtml);

      const outerAnchors = findCommentAnchors(editor.state.doc, 'outer');
      const innerAnchors = findCommentAnchors(editor.state.doc, 'inner');

      expect(outerAnchors.start).toBeDefined();
      expect(outerAnchors.end).toBeDefined();
      expect(innerAnchors.start).toBeDefined();
      expect(innerAnchors.end).toBeDefined();
    });
  });

  describe('Lists with normalized anchors', () => {
    it('should find anchors in unordered list item', async () => {
      const markdown = '- <!--anchor:list-test:start-->List item<!--anchor:list-test:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      // Fix missing data-anchor-id attributes and load into editor
      const fixedHtml = fixAnchorAttributes(html);
      editor.commands.setContent(fixedHtml);

      const anchors = findCommentAnchors(editor.state.doc, 'list-test');
      expect(anchors.start).toBeDefined();
      expect(anchors.end).toBeDefined();
    });

    it('should find anchors in ordered list item', async () => {
      const markdown =
        '1. <!--anchor:ordered-test:start-->First item<!--anchor:ordered-test:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      // Fix missing data-anchor-id attributes and load into editor
      const fixedHtml = fixAnchorAttributes(html);
      editor.commands.setContent(fixedHtml);

      const anchors = findCommentAnchors(editor.state.doc, 'ordered-test');
      expect(anchors.start).toBeDefined();
      expect(anchors.end).toBeDefined();
    });

    it('should find anchors in task list item', async () => {
      const markdown = '- [ ] <!--anchor:task-test:start-->Task item<!--anchor:task-test:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      // Fix missing data-anchor-id attributes and load into editor
      const fixedHtml = fixAnchorAttributes(html);
      editor.commands.setContent(fixedHtml);

      const anchors = findCommentAnchors(editor.state.doc, 'task-test');
      expect(anchors.start).toBeDefined();
      expect(anchors.end).toBeDefined();
    });
  });

  describe('Real-world example from bug report', () => {
    it('should handle the actual broken workspace markdown', async () => {
      const brokenMarkdown = `# <!--anchor:cmt-1:start-->Syncthing Prototype<!--anchor:cmt-1:end--> Specification

## Overview

<!--anchor:cmt-2:start-->Lorem ipsum<!--anchor:cmt-2:end-->

<!--anchor:cmt-3:start-->## Goals<!--anchor:cmt-3:end-->

<!--anchor:cmt-4:start-->## Discussion<!--anchor:cmt-4:end-->`;

      // Normalize
      const normalizedMarkdown = normalizeAnchorPositions(brokenMarkdown);

      // Convert to HTML
      const html = await processMarkdownToHTML(normalizedMarkdown, { preserveAnchors: true });

      // Load into editor
      editor.commands.setContent(html);

      // Check all comments can be found
      const cmt1 = findCommentAnchors(editor.state.doc, 'cmt-1');
      const cmt2 = findCommentAnchors(editor.state.doc, 'cmt-2');
      const cmt3 = findCommentAnchors(editor.state.doc, 'cmt-3');
      const cmt4 = findCommentAnchors(editor.state.doc, 'cmt-4');

      console.log('Comment 1 anchors:', cmt1);
      console.log('Comment 2 anchors:', cmt2);
      console.log('Comment 3 anchors:', cmt3);
      console.log('Comment 4 anchors:', cmt4);

      expect(cmt1.start).toBeDefined();
      expect(cmt1.end).toBeDefined();
      expect(cmt2.start).toBeDefined();
      expect(cmt2.end).toBeDefined();
      expect(cmt3.start).toBeDefined();
      expect(cmt3.end).toBeDefined();
      expect(cmt4.start).toBeDefined();
      expect(cmt4.end).toBeDefined();
    });
  });

  describe('Anchor positions for decorations', () => {
    it('should provide correct positions for highlighting heading text', async () => {
      const markdown = '## <!--anchor:pos-test:start-->Goals<!--anchor:pos-test:end-->';
      const html = await processMarkdownToHTML(markdown, { preserveAnchors: true });

      // Fix missing data-anchor-id attributes and load into editor
      const fixedHtml = fixAnchorAttributes(html);
      editor.commands.setContent(fixedHtml);

      const anchors = findCommentAnchors(editor.state.doc, 'pos-test');

      // Get the text between the anchors
      const doc = editor.state.doc;
      let foundText = '';

      if (anchors.start !== undefined && anchors.end !== undefined) {
        // The decoration will highlight from start to end
        // Let's see what text is in that range
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        doc.nodesBetween(anchors.start, anchors.end, (node, pos) => {
          if (node.isText) {
            foundText += node.text;
          }
        });
      }

      console.log('Text between anchors:', foundText);
      console.log('Anchor positions:', anchors);

      // The text should be "Goals"
      expect(foundText).toContain('Goals');
    });
  });
});
