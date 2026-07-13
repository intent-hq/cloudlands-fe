import type { Editor } from '@tiptap/core';

/**
 * Position information for a block in the DOM
 */
export interface BlockPositionInfo {
  /** Top position relative to the editor container (in pixels) */
  top: number;
  /** Height of the block (in pixels) */
  height: number;
  /** The DOM element for this block */
  element: HTMLElement;
}

/**
 * Position information for a single line within a code block
 */
export interface CodeBlockLinePositionInfo {
  /** Line number within the code block (0-based, relative to code block start) */
  lineIndex: number;
  /** Top position relative to the editor container (in pixels) */
  top: number;
  /** Height of the line (in pixels) */
  height: number;
}

/**
 * Text offset map entry - maps a text node to its character offset range
 */
export interface TextOffsetMapEntry {
  node: Text;
  start: number;
  end: number;
}

/**
 * Get all text nodes within an element in document order
 * This is useful for syntax-highlighted code blocks where text is split across multiple <span> elements
 *
 * @param element - The element to search within
 * @returns Array of text nodes in document order
 */
export function getAllTextNodes(element: Element): Text[] {
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);

  let node;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  return textNodes;
}

/**
 * Build a map of character offsets to text nodes
 * This allows us to find which text node contains a given character offset
 *
 * @param textNodes - Array of text nodes in document order
 * @returns Array of offset map entries
 */
export function buildTextOffsetMap(textNodes: Text[]): TextOffsetMapEntry[] {
  let currentOffset = 0;
  return textNodes.map((node) => {
    const length = node.textContent?.length || 0;
    const entry = {
      node,
      start: currentOffset,
      end: currentOffset + length,
    };
    currentOffset += length;
    return entry;
  });
}

/**
 * Find the text node that contains a given character offset
 * Returns the text node and the local offset within that node
 *
 * @param offsetMap - The offset map built from text nodes
 * @param offset - The character offset to find
 * @returns Object with node and localOffset, or null if not found
 */
export function findTextNodeForOffset(
  offsetMap: TextOffsetMapEntry[],
  offset: number,
): { node: Text; localOffset: number } | null {
  for (const entry of offsetMap) {
    if (offset >= entry.start && offset < entry.end) {
      return {
        node: entry.node,
        localOffset: offset - entry.start,
      };
    }
  }
  return null;
}

/**
 * Resolve the DOM position for a ProseMirror block
 *
 * This function:
 * 1. Gets the DOM node at the given ProseMirror position
 * 2. Handles special cases (e.g., list items with nested lists)
 * 3. Returns position info relative to the editor container
 *
 * @param editor - TipTap editor instance
 * @param position - ProseMirror position (typically blockPos + 1)
 * @returns Position info, or null if the block can't be found
 */
export function resolveBlockPosition(editor: Editor, position: number): BlockPositionInfo | null {
  // Check if editor view is available (not yet mounted or destroyed)
  if (!editor?.view?.dom) {
    return null;
  }

  // Find the DOM node at this position
  const domNode = editor.view.nodeDOM(position - 1);

  if (!domNode || !(domNode instanceof HTMLElement)) {
    return null;
  }

  // For list items that contain nested lists, we only want to measure the direct content,
  // not the nested children. Look for the direct paragraph child.
  let measureNode = domNode;
  if (domNode.tagName === 'LI') {
    // Check if this list item has nested lists
    const hasNestedList = domNode.querySelector(':scope > ol, :scope > ul') !== null;
    if (hasNestedList) {
      // Find the direct paragraph (either direct child or inside a div wrapper)
      const directParagraph = domNode.querySelector(':scope > p, :scope > div > p');
      if (directParagraph instanceof HTMLElement) {
        measureNode = directParagraph;
      }
    }
  }

  const rect = measureNode.getBoundingClientRect();
  const editorRect = editor.view.dom.getBoundingClientRect();

  // Calculate position relative to the editor
  const top = rect.top - editorRect.top;
  const height = rect.height;

  return {
    top,
    height,
    element: measureNode,
  };
}

/**
 * Resolve per-line positions for a code block using the Range API
 *
 * This function handles syntax-highlighted code blocks where text is split across
 * multiple <span> elements. It uses the DOM Range API to get accurate bounding rects
 * for each line, which properly handles line wrapping and variable line heights.
 *
 * @param editor - TipTap editor instance
 * @param position - ProseMirror position of the code block (typically blockPos + 1)
 * @returns Array of position info for each line, or empty array if not a code block
 */
export function resolveCodeBlockLinePositions(
  editor: Editor,
  position: number,
): CodeBlockLinePositionInfo[] {
  // Check if editor view is available (not yet mounted or destroyed)
  if (!editor?.view?.dom) {
    return [];
  }

  // Find the DOM node at this position
  const domNode = editor.view.nodeDOM(position - 1);

  if (!domNode || !(domNode instanceof HTMLElement)) {
    return [];
  }

  // Check if this is a code block (should be <pre> or contain <code>)
  const codeElement = domNode.tagName === 'CODE' ? domNode : domNode.querySelector('code');

  if (!codeElement) {
    return [];
  }

  // Get all text content from the code element
  const text = codeElement.textContent || '';
  const lines = text.split('\n');

  // Get all text nodes and build offset map
  // This handles syntax-highlighted code where text is split across <span> elements
  const textNodes = getAllTextNodes(codeElement);
  if (textNodes.length === 0) {
    return [];
  }

  const offsetMap = buildTextOffsetMap(textNodes);
  const editorRect = editor.view.dom.getBoundingClientRect();
  const positions: CodeBlockLinePositionInfo[] = [];

  let currentOffset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip the last empty line if text ends with \n
    if (i === lines.length - 1 && line === '') {
      break;
    }

    const lineLength = line.length;
    const lineStart = currentOffset;
    const lineEnd = currentOffset + lineLength;

    // Find text nodes for this line's start and end
    const startNode = findTextNodeForOffset(offsetMap, lineStart);
    const endNode = findTextNodeForOffset(offsetMap, lineEnd > lineStart ? lineEnd - 1 : lineStart);

    if (startNode && endNode) {
      try {
        // Create a range spanning this line
        const range = document.createRange();
        range.setStart(startNode.node, startNode.localOffset);
        range.setEnd(endNode.node, endNode.localOffset + 1);

        // Get the bounding rect for this line
        // Note: jsdom doesn't implement getBoundingClientRect on Range, so we provide a fallback
        let rect: DOMRect;
        if (typeof range.getBoundingClientRect === 'function') {
          rect = range.getBoundingClientRect();
        } else {
          // Fallback for test environments (jsdom)
          // Use a simple height division as an approximation
          const codeRect = codeElement.getBoundingClientRect();
          const lineHeight = codeRect.height / lines.length;
          rect = {
            top: codeRect.top + i * lineHeight,
            height: lineHeight,
            left: codeRect.left,
            right: codeRect.right,
            bottom: codeRect.top + (i + 1) * lineHeight,
            width: codeRect.width,
            x: codeRect.left,
            y: codeRect.top + i * lineHeight,
            toJSON: () => ({}),
          } as DOMRect;
        }

        positions.push({
          lineIndex: i,
          top: rect.top - editorRect.top,
          height: rect.height,
        });
      } catch {
        // Fallback if range creation fails - silently continue
      }
    }

    // Move to next line (add 1 for the newline character)
    currentOffset = lineEnd + 1;
  }

  return positions;
}
