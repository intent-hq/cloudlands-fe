import type { Editor } from '@tiptap/core';
import { logger } from '$lib/utils/client-logger';

/**
 * Author information for line attribution
 */
export interface LineAuthor {
  id: string;
  name: string;
  type: 'user' | 'agent' | 'system';
  turnNumber?: number;
}

/**
 * Attribution info for a single line/block
 */
export interface AttributionInfo {
  timestamp: number; // milliseconds since epoch
  author?: LineAuthor;
}

/**
 * Line attribution data structure (from disk: .line-attribution.json)
 * Maps markdown line number (1-based) to attribution info
 */
export type LineAttributions = Map<number, AttributionInfo>;

/**
 * Attribution for a single line within a code block
 */
export interface CodeBlockLineAttribution {
  /** Line index within the code block (0-based, relative to code block content start) */
  lineIndex: number;
  /** Attribution info for this line */
  attribution: AttributionInfo;
}

/**
 * Block attribution value - either a single attribution or per-line attributions for code blocks
 */
export type BlockAttributionValue =
  | AttributionInfo
  | { type: 'codeBlock'; lines: CodeBlockLineAttribution[] };

/**
 * Block attribution data structure (for rendering in UI)
 * Maps ProseMirror block position to attribution info
 * - For regular blocks: AttributionInfo
 * - For code blocks: { type: 'codeBlock', lines: CodeBlockLineAttribution[] }
 */
export type BlockAttributions = Map<number, BlockAttributionValue>; // position → attribution info

/**
 * Map line attributions to block attributions
 *
 * APPROACH:
 * - Collect ALL block nodes including nested ones (e.g., listItem inside bulletList)
 * - Map each markdown line to its corresponding ProseMirror block
 * - For lists, map each markdown line to the individual listItem, not the parent list
 * - For each block, use the LATEST timestamp from all lines that map to it
 *
 * This correctly handles:
 * - Blank lines in markdown (don't create ProseMirror blocks)
 * - Nested list items (each item gets its own indicator)
 * - Code blocks (single block spanning multiple lines)
 *
 * @param editor - TipTap editor instance (already loaded with content)
 * @param lineAttributions - Map of line number → attribution info (loaded from .line-attribution.json)
 * @param markdown - The original markdown content (needed to count lines correctly)
 * @returns Map of block position → attribution info (for rendering decorations)
 */
export function mapLineAttributionsToBlocks(
  editor: Editor,
  lineAttributions: LineAttributions,
  markdown: string,
): BlockAttributions {
  const markdownLines = markdown.split('\n');

  // Build a map of markdown line → ProseMirror block position
  const lineToBlockPos = new Map<number, number>();

  // Collect ALL block nodes, including nested ones (like listItem inside bulletList)
  const blocks: Array<{ pos: number; node: any; type: string; depth: number }> = [];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  editor.state.doc.descendants((node, pos, parent, index) => {
    if (node.isBlock && node.type.name !== 'doc') {
      // Store the depth to help identify parent-child relationships
      const depth = editor.state.doc.resolve(pos).depth;

      blocks.push({ pos, node, type: node.type.name, depth });

      // For lists and list items (including task lists and task items), we want to descend into children to handle nested lists
      // For other blocks, we don't need to descend
      if (
        node.type.name === 'bulletList' ||
        node.type.name === 'orderedList' ||
        node.type.name === 'taskList' ||
        node.type.name === 'listItem' ||
        node.type.name === 'taskItem'
      ) {
        return true; // Continue descending to find nested lists/items
      }

      return false; // Don't descend into other blocks
    }
    return true;
  });

  // Filter out:
  // 1. List container blocks (bulletList, orderedList, taskList) - we only want listItems and taskItems
  // 2. Paragraphs that are direct children of listItems/taskItems - the listItem/taskItem itself represents the line
  //
  // Strategy: A paragraph is inside a listItem/taskItem if:
  // - There's a listItem/taskItem at the same or higher position
  // - The paragraph's depth is greater than the listItem/taskItem's depth
  // - There's no other block between them
  const renderableBlocks = blocks.filter((block, index) => {
    // Remove list containers
    if (block.type === 'bulletList' || block.type === 'orderedList' || block.type === 'taskList') {
      return false;
    }

    // Check if this paragraph is inside a listItem or taskItem
    if (block.type === 'paragraph') {
      // Look backwards to find the nearest listItem or taskItem
      for (let i = index - 1; i >= 0; i--) {
        const prevBlock = blocks[i];

        // If we find a listItem or taskItem at a shallower or equal depth, check if we're inside it
        if (prevBlock.type === 'listItem' || prevBlock.type === 'taskItem') {
          // If the paragraph is deeper than the listItem/taskItem, it's inside it
          if (block.depth > prevBlock.depth) {
            return false; // Filter out paragraphs inside listItems/taskItems
          }
          // If depths are equal or paragraph is shallower, we've exited the listItem/taskItem
          break;
        }

        // If we hit another block type at same or shallower depth, stop looking
        if (
          prevBlock.depth <= block.depth &&
          prevBlock.type !== 'bulletList' &&
          prevBlock.type !== 'orderedList' &&
          prevBlock.type !== 'taskList'
        ) {
          break;
        }
      }
    }

    return true;
  });

  // Check for duplicate positions
  const positions = renderableBlocks.map((b) => b.pos);
  const uniquePositions = new Set(positions);
  if (positions.length !== uniquePositions.size) {
    logger.warn(
      `[line-to-block-mapper] WARNING: Found ${positions.length - uniquePositions.size} duplicate block positions!`,
    );
    // Log the duplicates
    const positionCounts = new Map<number, number>();
    positions.forEach((pos) => {
      positionCounts.set(pos, (positionCounts.get(pos) || 0) + 1);
    });
     
    const duplicates = Array.from(positionCounts.entries()).filter(([_, count]) => count > 1);
    logger.warn('[line-to-block-mapper] Duplicate positions:', duplicates);
  }

  // Now map markdown lines to blocks
  // Strategy: Build a flat list of all list items (including task items) in document order by doing a depth-first traversal
  // This matches the order that markdown lines appear in (parent, then nested children, then next parent)

  // First, collect all listItems and taskItems in document order (depth-first)
  const listItemsInOrder: Array<{ pos: number; node: any }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      listItemsInOrder.push({ pos, node });
    }
    return true; // Continue descending
  });

  // Now map markdown lines to blocks
  let blockIndex = 0;
  let listItemIndex = 0;
  let inCodeBlock = false;
  let currentCodeBlockPos: number | null = null;

  for (let lineNum = 1; lineNum <= markdownLines.length; lineNum++) {
    const line = markdownLines[lineNum - 1];

    // Skip blank lines - they don't correspond to any block
    if (line.trim() === '') {
      continue;
    }

    // Check if this line is a code fence (opening or closing)
    // Must be ONLY whitespace + backticks + optional language identifier
    // This prevents false positives from corrupted markdown where backticks appear mid-line
    const isCodeFence = /^\s*```[a-z0-9]*\s*$/i.test(line);

    if (isCodeFence) {
      if (!inCodeBlock) {
        // Opening code fence - find the next code block
        while (
          blockIndex < renderableBlocks.length &&
          (renderableBlocks[blockIndex].type === 'listItem' ||
            renderableBlocks[blockIndex].type === 'taskItem')
        ) {
          blockIndex++;
        }

        if (
          blockIndex < renderableBlocks.length &&
          renderableBlocks[blockIndex].type === 'codeBlock'
        ) {
          inCodeBlock = true;
          currentCodeBlockPos = renderableBlocks[blockIndex].pos;
          lineToBlockPos.set(lineNum, currentCodeBlockPos);
        }
      } else {
        // Closing code fence - map to same code block and advance
        if (currentCodeBlockPos !== null) {
          lineToBlockPos.set(lineNum, currentCodeBlockPos);
        }
        inCodeBlock = false;
        currentCodeBlockPos = null;
        blockIndex++;
      }
      continue;
    }

    // If we're inside a code block, map to the current code block
    if (inCodeBlock && currentCodeBlockPos !== null) {
      lineToBlockPos.set(lineNum, currentCodeBlockPos);
      continue;
    }

    // Check if this is a list item or task item line
    // - Regular list items: starts with -, *, +, or number. followed by space
    // - Task items: starts with - [ ] or - [x] (with optional spaces inside brackets)
    // Note: Must have a space after the marker to distinguish from horizontal rules (---)
    const isListItem = /^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line);
    const isTaskItem = /^\s*-\s*\[\s*[xX\s]?\s*\]/.test(line);

    if ((isListItem || isTaskItem) && listItemIndex < listItemsInOrder.length) {
      // Map to the next list item or task item in document order
      const block = listItemsInOrder[listItemIndex];
      lineToBlockPos.set(lineNum, block.pos);
      listItemIndex++;
    } else {
      // Map to the next non-listItem/non-taskItem/non-codeBlock block
      while (
        blockIndex < renderableBlocks.length &&
        (renderableBlocks[blockIndex].type === 'listItem' ||
          renderableBlocks[blockIndex].type === 'taskItem' ||
          renderableBlocks[blockIndex].type === 'codeBlock')
      ) {
        blockIndex++;
      }

      if (blockIndex < renderableBlocks.length) {
        const block = renderableBlocks[blockIndex];
        lineToBlockPos.set(lineNum, block.pos);
        blockIndex++;
      }
    }
  }

  // Now collect attributions for each block
  const blockToAttributions = new Map<number, AttributionInfo[]>();
  const blockToLineNumbers = new Map<number, number[]>(); // Track which markdown lines map to each block

  for (const [lineNum, blockPos] of lineToBlockPos.entries()) {
    const attribution = lineAttributions.get(lineNum);
    if (attribution) {
      if (!blockToAttributions.has(blockPos)) {
        blockToAttributions.set(blockPos, []);
        blockToLineNumbers.set(blockPos, []);
      }
      blockToAttributions.get(blockPos)!.push(attribution);
      blockToLineNumbers.get(blockPos)!.push(lineNum);
    }
  }

  // Log the complete line-to-block mapping
  const mappingTable = [];
  for (const [lineNum, blockPos] of lineToBlockPos.entries()) {
    const line = markdownLines[lineNum - 1];
    const attribution = lineAttributions.get(lineNum);
    if (attribution) {
      mappingTable.push({
        line: lineNum,
        text: line.substring(0, 40) + (line.length > 40 ? '...' : ''),
        blockPos,
        finalPos: blockPos + 1,
        hasAttribution: !!attribution,
        turnNumber: attribution?.author?.turnNumber,
      });
    }
  }

  // For each block, determine if it's a code block and handle accordingly
  const blockAttributions = new Map<number, BlockAttributionValue>();

  for (const [blockPos, attributions] of blockToAttributions.entries()) {
    // Find the block node to check if it's a code block
    const blockNode = renderableBlocks.find((b) => b.pos === blockPos);
    const isCodeBlock = blockNode?.type === 'codeBlock';

    if (isCodeBlock && blockNode) {
      // For code blocks, create per-line attributions
      const lineNumbers = blockToLineNumbers.get(blockPos) || [];

      // Find the opening fence line (first line in lineNumbers)
      const openingFenceLineNum = lineNumbers[0];
      if (!openingFenceLineNum) {
        continue;
      }

      // Filter out fence lines (opening ``` and closing ```)
      // AND filter out lines without attribution data
      const contentLineNumbers = lineNumbers.filter((lineNum) => {
        const line = markdownLines[lineNum - 1];
        // Use same strict fence detection as above
        const isFence = /^\s*```[a-z0-9]*\s*$/i.test(line);
        const hasAttribution = lineAttributions.has(lineNum);
        return !isFence && hasAttribution;
      });

      // Map each content line to its attribution
      // IMPORTANT: Calculate the actual line index within the code block
      // by subtracting the opening fence line number
      const codeBlockLines: CodeBlockLineAttribution[] = contentLineNumbers.map((lineNum) => {
        const attribution = lineAttributions.get(lineNum)!;
        // lineIndex is 0-based, relative to the first content line (after opening fence)
        const lineIndex = lineNum - openingFenceLineNum - 1;
        return {
          lineIndex,
          attribution,
        };
      });

      blockAttributions.set(blockPos + 1, {
        type: 'codeBlock',
        lines: codeBlockLines,
      });
    } else {
      // For regular blocks, use the LATEST timestamp
      const latestAttribution = attributions.reduce((latest, current) =>
        current.timestamp > latest.timestamp ? current : latest,
      );

      // Store by position (pos + 1 to get inside the block)
      blockAttributions.set(blockPos + 1, latestAttribution);
    }
  }

  return blockAttributions;
}
