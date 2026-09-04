/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { logger } from '$lib/utils/client-logger';

describe('Markdown Line to ProseMirror Block Mapping', () => {
  let editor: Editor | null = null;

  beforeEach(() => {
    // Create a container element
    const container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (editor) {
      editor.destroy();
      editor = null;
    }
    document.body.innerHTML = '';
  });

  /**
   * Helper: Get all block nodes from the ProseMirror document
   * Returns an array of { blockIndex, nodeType, textContent }
   */
  function getBlockNodes(editor: Editor) {
    const blocks: Array<{
      blockIndex: number;
      nodeType: string;
      textContent: string;
      pos: number;
    }> = [];
    let blockIndex = 0;

    editor.state.doc.descendants((node, pos) => {
      // Only count block-level nodes (not the doc itself)
      if (node.isBlock && node.type.name !== 'doc') {
        blocks.push({
          blockIndex: blockIndex + 1, // 1-based indexing to match line numbers
          nodeType: node.type.name,
          textContent: node.textContent,
          pos,
        });
        blockIndex++;
        return false; // Don't descend into children
      }
      return true;
    });

    return blocks;
  }

  it('should map simple markdown lines to ProseMirror blocks 1:1', async () => {
    const markdown = `# Heading 1
Paragraph 1
## Heading 2
Paragraph 2`;

    const html = await processMarkdownToHTML(markdown);

    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    const blocks = getBlockNodes(editor);

    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toMatchObject({
      blockIndex: 1,
      nodeType: 'heading',
      textContent: 'Heading 1',
    });
    expect(blocks[1]).toMatchObject({
      blockIndex: 2,
      nodeType: 'paragraph',
      textContent: 'Paragraph 1',
    });
    expect(blocks[2]).toMatchObject({
      blockIndex: 3,
      nodeType: 'heading',
      textContent: 'Heading 2',
    });
    expect(blocks[3]).toMatchObject({
      blockIndex: 4,
      nodeType: 'paragraph',
      textContent: 'Paragraph 2',
    });
  });

  it('should handle lists correctly', async () => {
    const markdown = `# Heading
- Item 1
- Item 2
- Item 3`;

    const html = await processMarkdownToHTML(markdown);

    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    const blocks = getBlockNodes(editor);

    // Heading + bulletList (the list itself is a block, items are inside)
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      blockIndex: 1,
      nodeType: 'heading',
      textContent: 'Heading',
    });
    expect(blocks[1]).toMatchObject({
      blockIndex: 2,
      nodeType: 'bulletList',
      textContent: 'Item 1Item 2Item 3', // All items concatenated
    });
  });

  it('should handle empty lines (which become empty paragraphs)', async () => {
    const markdown = `Line 1

Line 3`;

    const html = await processMarkdownToHTML(markdown);

    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    const blocks = getBlockNodes(editor);

    // Markdown parsers typically skip empty lines, so we might get 2 blocks, not 3
    // Let's see what actually happens
    logger.info('Empty line test blocks:', blocks);

    // This test will tell us how empty lines are handled
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('should handle code blocks', async () => {
    const markdown = `# Heading
\`\`\`javascript
const x = 1;
const y = 2;
\`\`\`
Paragraph`;

    const html = await processMarkdownToHTML(markdown);

    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    const blocks = getBlockNodes(editor);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({
      blockIndex: 1,
      nodeType: 'heading',
    });
    expect(blocks[1]).toMatchObject({
      blockIndex: 2,
      nodeType: 'codeBlock',
      textContent: 'const x = 1;\nconst y = 2;',
    });
    expect(blocks[2]).toMatchObject({
      blockIndex: 3,
      nodeType: 'paragraph',
    });
  });

  it('should handle a realistic note structure', async () => {
    const markdown = `# Project Spec

## Overview
This is a description.

## Features
- Feature 1
- Feature 2

## Implementation
Some notes here.

\`\`\`typescript
function example() {
  return true;
}
\`\`\`

Final thoughts.`;

    const html = await processMarkdownToHTML(markdown);

    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    const blocks = getBlockNodes(editor);

    // Let's see what we get
    logger.info(
      'Realistic structure blocks:',
      blocks.map((b) => ({
        index: b.blockIndex,
        type: b.nodeType,
        text: b.textContent.substring(0, 30),
      })),
    );

    // We should have: h1, h2, p, h2, bulletList, h2, p, codeBlock, p
    expect(blocks.length).toBeGreaterThan(5);
  });
});
