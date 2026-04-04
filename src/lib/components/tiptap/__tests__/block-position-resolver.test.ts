/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  resolveBlockPosition,
  resolveCodeBlockLinePositions,
  getAllTextNodes,
  buildTextOffsetMap,
  findTextNodeForOffset,
} from '../block-position-resolver';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';


describe('Block Position Resolver', () => {
  let editor: Editor | null = null;

  beforeEach(() => {
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

  it('should resolve position for a simple heading', async () => {
    const markdown = `# Heading

Paragraph`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    // Heading is at position 0, so we query position 1 (inside the block)
    const positionInfo = resolveBlockPosition(editor, 1);

    expect(positionInfo).not.toBeNull();
    expect(positionInfo!.top).toBeTypeOf('number');
    expect(positionInfo!.height).toBeTypeOf('number');
    expect(positionInfo!.height).toBeGreaterThanOrEqual(0); // jsdom has no layout, so height may be 0
    expect(positionInfo!.element).toBeInstanceOf(HTMLElement);
  });

  it('should return null for invalid position', async () => {
    const markdown = '# Heading';

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    // Query a position that doesn't exist
    const positionInfo = resolveBlockPosition(editor, 9999);

    expect(positionInfo).toBeNull();
  });

  it('should handle list items correctly', async () => {
    const markdown = `# Heading

- Item 1
- Item 2`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    // Find list item positions by walking the document
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'listItem') {
        positions.push(pos + 1); // +1 to get inside the block
      }
    });

    expect(positions.length).toBe(2);

    // Resolve position for first list item
    const positionInfo = resolveBlockPosition(editor, positions[0]);

    expect(positionInfo).not.toBeNull();
    expect(positionInfo!.height).toBeGreaterThanOrEqual(0); // jsdom has no layout
  });

  it('should handle nested lists by measuring only direct content', async () => {
    const markdown = `- Item 1
  - Nested 1.1
- Item 2`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    // Find the first list item (which has a nested list)
    let firstListItemPos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'listItem' && firstListItemPos === null) {
        firstListItemPos = pos + 1;
      }
    });

    expect(firstListItemPos).not.toBeNull();

    const positionInfo = resolveBlockPosition(editor, firstListItemPos!);

    expect(positionInfo).not.toBeNull();

    // The key test: the height should be for the direct content only,
    // not including the nested list. We can't assert an exact height,
    // but we can verify that the element is a paragraph (the direct content)
    // rather than the full LI element.
    expect(positionInfo!.element.tagName).toBe('P');
  });

  it('should calculate position relative to editor container', async () => {
    const markdown = `# Heading 1

Paragraph 1

# Heading 2

Paragraph 2`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    // Get positions for both headings
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        positions.push(pos + 1);
      }
    });

    expect(positions.length).toBe(2);

    const pos1 = resolveBlockPosition(editor, positions[0]);
    const pos2 = resolveBlockPosition(editor, positions[1]);

    expect(pos1).not.toBeNull();
    expect(pos2).not.toBeNull();

    // Second heading should be below the first (or at same position in jsdom with no layout)
    expect(pos2!.top).toBeGreaterThanOrEqual(pos1!.top);
  });

  it('should resolve per-line positions for code blocks', async () => {
    const markdown = `# Heading

\`\`\`sql
SELECT * FROM users
WHERE id = 1;
ORDER BY name;
\`\`\`

## Next`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    // Find the code block position
    let codeBlockPos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock' && codeBlockPos === null) {
        codeBlockPos = pos + 1; // +1 to get inside the block
      }
    });

    expect(codeBlockPos).not.toBeNull();

    // Resolve per-line positions
    const linePositions = resolveCodeBlockLinePositions(editor, codeBlockPos!);

    // Should have 3 lines (not counting the empty line after final \n)
    expect(linePositions.length).toBe(3);

    // Each line should have position info
    linePositions.forEach((linePos, i) => {
      expect(linePos.lineIndex).toBe(i);
      expect(linePos.top).toBeTypeOf('number');
      expect(linePos.height).toBeTypeOf('number');
      expect(linePos.height).toBeGreaterThanOrEqual(0); // jsdom has no layout
    });
  });

  it('should return empty array for non-code-block positions', async () => {
    const markdown = `# Heading

Paragraph`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    // Try to get line positions for a heading (not a code block)
    const linePositions = resolveCodeBlockLinePositions(editor, 1);

    expect(linePositions).toEqual([]);
  });
});

describe('Text Node Walking Helpers', () => {
  describe('getAllTextNodes', () => {
    it('should find all text nodes in a simple element', () => {
      const div = document.createElement('div');
      div.textContent = 'Hello World';

      // We'll implement this function
      const textNodes = getAllTextNodes(div);

      expect(textNodes).toHaveLength(1);
      expect(textNodes[0].textContent).toBe('Hello World');
    });

    it('should find text nodes across multiple spans (syntax highlighting)', () => {
      const code = document.createElement('code');
      code.innerHTML =
        '<span class="hljs-keyword">const</span> <span class="hljs-variable">x</span> = <span class="hljs-number">42</span>';

      const textNodes = getAllTextNodes(code);

      expect(textNodes).toHaveLength(5); // "const", " ", "x", " = ", "42"
      expect(textNodes.map((n) => n.textContent).join('')).toBe('const x = 42');
    });

    it('should handle nested elements', () => {
      const div = document.createElement('div');
      div.innerHTML = '<span>Line <strong>one</strong></span>\n<span>Line two</span>';

      const textNodes = getAllTextNodes(div);

      expect(textNodes.map((n) => n.textContent).join('')).toBe('Line one\nLine two');
    });

    it('should return empty array for element with no text', () => {
      const div = document.createElement('div');
      div.innerHTML = '<img src="test.png">';

      const textNodes = getAllTextNodes(div);

      expect(textNodes).toHaveLength(0);
    });
  });

  describe('buildTextOffsetMap', () => {
    it('should map character offsets to text nodes', () => {
      const div = document.createElement('div');
      div.innerHTML = '<span>Hello</span> <span>World</span>';
      const textNodes = getAllTextNodes(div);

      const offsetMap = buildTextOffsetMap(textNodes);

      // "Hello" = 0-4, " " = 5, "World" = 6-10
      expect(offsetMap).toHaveLength(3);
      expect(offsetMap[0]).toMatchObject({ start: 0, end: 5 });
      expect(offsetMap[1]).toMatchObject({ start: 5, end: 6 });
      expect(offsetMap[2]).toMatchObject({ start: 6, end: 11 });
    });

    it('should handle empty text nodes', () => {
      const div = document.createElement('div');
      const span1 = document.createElement('span');
      span1.textContent = 'Hello';
      const span2 = document.createElement('span');
      span2.textContent = '';
      const span3 = document.createElement('span');
      span3.textContent = 'World';
      div.appendChild(span1);
      div.appendChild(span2);
      div.appendChild(span3);

      const textNodes = getAllTextNodes(div);
      const offsetMap = buildTextOffsetMap(textNodes);

      // Should skip empty text nodes or handle them gracefully
      expect(offsetMap.length).toBeGreaterThan(0);
    });
  });

  describe('findTextNodeForOffset', () => {
    it('should find the correct text node for a given offset', () => {
      const div = document.createElement('div');
      div.innerHTML = '<span>Hello</span> <span>World</span>';
      const textNodes = getAllTextNodes(div);
      const offsetMap = buildTextOffsetMap(textNodes);

      // Offset 0 should be in "Hello"
      const result0 = findTextNodeForOffset(offsetMap, 0);
      expect(result0?.node.textContent).toBe('Hello');
      expect(result0?.localOffset).toBe(0);

      // Offset 3 should be in "Hello" at position 3
      const result3 = findTextNodeForOffset(offsetMap, 3);
      expect(result3?.node.textContent).toBe('Hello');
      expect(result3?.localOffset).toBe(3);

      // Offset 6 should be in "World" at position 0
      const result6 = findTextNodeForOffset(offsetMap, 6);
      expect(result6?.node.textContent).toBe('World');
      expect(result6?.localOffset).toBe(0);
    });

    it('should return null for out-of-bounds offset', () => {
      const div = document.createElement('div');
      div.textContent = 'Hello';
      const textNodes = getAllTextNodes(div);
      const offsetMap = buildTextOffsetMap(textNodes);

      const result = findTextNodeForOffset(offsetMap, 100);
      expect(result).toBeNull();
    });
  });
});
