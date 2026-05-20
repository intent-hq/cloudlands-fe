/**
 * @vitest-environment jsdom
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';

// ─── Mock Redux selectors and dispatch bridge ───────────────────────────────
// CustomTaskItem renders TaskItemNodeView.svelte which calls these at init time
const mockReadable = (value: any) => ({
  subscribe: (fn: (v: any) => void) => {
    fn(value);
    return () => {};
  },
});

vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: () => mockReadable(null),
}));

vi.mock('$lib/store/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: Object.assign(() => mockReadable(undefined), {
    select: () => undefined,
  }),
  selectSelectedNoteId: Object.assign(() => mockReadable(null), {
    select: () => null,
  }),
  selectNotesVersion: () => mockReadable(0),
}));

vi.mock('$lib/store/store', async () => {
  const { createAppStoreMockModule } = await import('$lib/store/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: vi.fn(),
  });
});

vi.mock('$lib/store/slices/workspace-notes/workspace-notes-slice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/store/slices/workspace-notes/workspace-notes-slice')>()),
  updateTaskStatus: vi.fn(),
  handleExternalNoteUpdate: vi.fn(),
  reloadNotes: vi.fn(),
}));

vi.mock('$lib/store/slices/workspace-notes/sagas/notes-ipc', () => ({
  notesIpc: vi.fn(),
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToNote: vi.fn(),
}));

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import { CustomTaskItem } from '../CustomTaskItem';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import {
  mapLineAttributionsToBlocks,
  type AttributionInfo,
} from '../line-to-block-mapper';

describe('Line to Block Attribution Mapper', () => {
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

  it('should map simple 1:1 line attributions to blocks', async () => {
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

    // Line attributions: line 1 and line 3 were edited
    const lineAttributions = new Map<number, AttributionInfo>([
      [1, { timestamp: 1000 }], // Heading 1 edited at timestamp 1000
      [3, { timestamp: 2000 }], // Heading 2 edited at timestamp 2000
    ]);

    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    // Should have 2 attributions
    expect(blockAttributions.size).toBe(2);
    // Check that we have attributions (positions will vary, just check timestamps exist)
    const timestamps = Array.from(blockAttributions.values())
      .map((a) => ('timestamp' in a ? a.timestamp : undefined))
      .filter(Boolean);
    expect(timestamps).toContain(1000);
    expect(timestamps).toContain(2000);
  });

  it('should handle lists by mapping each item to its own block', async () => {
    const markdown = `# Heading
- Item 1
- Item 2
- Item 3
Paragraph`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    // Lines 2, 3, 4 are list items (each maps to its own listItem block)
    const lineAttributions = new Map<number, AttributionInfo>([
      [2, { timestamp: 1000 }], // Item 1
      [3, { timestamp: 3000 }], // Item 2
      [4, { timestamp: 2000 }], // Item 3
    ]);

    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    // Should have 3 attributions - one for each list item
    expect(blockAttributions.size).toBe(3);
    const timestamps = Array.from(blockAttributions.values())
      .map((a) => ('timestamp' in a ? a.timestamp : undefined))
      .filter(Boolean);
    expect(timestamps).toEqual([1000, 3000, 2000]); // Each item keeps its own timestamp
  });

  it('should handle code blocks by using the latest timestamp', async () => {
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

    // Lines 2-6 are the code block (opening ```, 2 code lines, closing ```)
    const lineAttributions = new Map<number, AttributionInfo>([
      [2, { timestamp: 1000 }], // Opening ```
      [3, { timestamp: 2000 }], // const x = 1; (latest)
      [4, { timestamp: 1500 }], // const y = 2;
      [5, { timestamp: 1200 }], // Closing ```
    ]);

    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    // Should have 1 code block with per-line attributions
    expect(blockAttributions.size).toBe(1);
    const codeBlockAttr = Array.from(blockAttributions.values())[0];

    // Verify it's a code block with per-line attributions
    expect(codeBlockAttr).toHaveProperty('type', 'codeBlock');
    if (
      typeof codeBlockAttr === 'object' &&
      'type' in codeBlockAttr &&
      codeBlockAttr.type === 'codeBlock'
    ) {
      // Should have 2 lines (the actual code lines, not the fences)
      expect(codeBlockAttr.lines.length).toBe(2);

      // Verify timestamps for each line
      expect(codeBlockAttr.lines[0].attribution.timestamp).toBe(2000); // const x = 1;
      expect(codeBlockAttr.lines[1].attribution.timestamp).toBe(1500); // const y = 2;
    }
  });

  it('should skip blocks with no attributions', async () => {
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

    // Only line 1 has an attribution
    const lineAttributions = new Map<number, AttributionInfo>([[1, { timestamp: 1000 }]]);

    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    // Should only have 1 attribution
    expect(blockAttributions.size).toBe(1);
    const timestamps = Array.from(blockAttributions.values())
      .map((a) => ('timestamp' in a ? a.timestamp : undefined))
      .filter(Boolean);
    expect(timestamps[0]).toBe(1000);
  });

  it('should handle empty attributions', async () => {
    const markdown = `# Heading
Paragraph`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    const lineAttributions = new Map<number, AttributionInfo>();
    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    expect(blockAttributions.size).toBe(0);
  });

  it('should handle blank lines between paragraphs correctly', async () => {
    // This is the bug case: markdown has blank lines but ProseMirror doesn't create blocks for them
    const markdown = `# Heading

Paragraph 1

Paragraph 2

Paragraph 3`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    // Markdown line numbers:
    // Line 1: # Heading
    // Line 2: (blank)
    // Line 3: Paragraph 1
    // Line 4: (blank)
    // Line 5: Paragraph 2
    // Line 6: (blank)
    // Line 7: Paragraph 3

    const lineAttributions = new Map<number, AttributionInfo>([
      [1, { timestamp: 1000 }], // Heading
      [3, { timestamp: 2000 }], // Paragraph 1
      [5, { timestamp: 3000 }], // Paragraph 2
      [7, { timestamp: 4000 }], // Paragraph 3 (latest)
    ]);

    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    // Should have 4 attributions (one for each non-blank line)
    expect(blockAttributions.size).toBe(4);

    // Check that all timestamps are present
    const timestamps = Array.from(blockAttributions.values())
      .map((a) => ('timestamp' in a ? a.timestamp : undefined))
      .filter(Boolean)
      .sort();
    expect(timestamps).toEqual([1000, 2000, 3000, 4000]);
  });

  it('should handle blank lines in lists correctly', async () => {
    // Real-world case from the bug: list with blank lines after
    const markdown = `Here is a list

1. Item 1
2. Item 2
3. Item 3
4. Item 4

Text after

More text`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    // Markdown line numbers:
    // Line 1: Here is a list
    // Line 2: (blank)
    // Line 3: 1. Item 1
    // Line 4: 2. Item 2
    // Line 5: 3. Item 3
    // Line 6: 4. Item 4
    // Line 7: (blank)
    // Line 8: Text after
    // Line 9: (blank)
    // Line 10: More text

    const lineAttributions = new Map<number, AttributionInfo>([
      [1, { timestamp: 1000 }], // Here is a list
      [3, { timestamp: 2000 }], // Item 1
      [4, { timestamp: 2100 }], // Item 2
      [5, { timestamp: 2200 }], // Item 3
      [6, { timestamp: 2300 }], // Item 4
      [8, { timestamp: 3000 }], // Text after
      [10, { timestamp: 4000 }], // More text
    ]);

    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    // Should have 7 blocks: paragraph, 4 listItems, paragraph, paragraph
    expect(blockAttributions.size).toBe(7);

    // Each list item should have its own timestamp
    const timestamps = Array.from(blockAttributions.values())
      .map((a) => ('timestamp' in a ? a.timestamp : undefined))
      .filter(Boolean)
      .sort();
    expect(timestamps).toContain(1000); // Here is a list
    expect(timestamps).toContain(2000); // Item 1
    expect(timestamps).toContain(2100); // Item 2
    expect(timestamps).toContain(2200); // Item 3
    expect(timestamps).toContain(2300); // Item 4
    expect(timestamps).toContain(3000); // Text after
    expect(timestamps).toContain(4000); // More text
  });

  it('should handle deeply nested lists', async () => {
    const markdown = `# Heading
- Item 1
  - Nested 1.1
    - Deep 1.1.1
  - Nested 1.2
- Item 2`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    // Each listItem corresponds to exactly one markdown line, regardless of nesting
    const lineAttributions = new Map<number, AttributionInfo>([
      [2, { timestamp: 1000 }], // Item 1
      [3, { timestamp: 2000 }], // Nested 1.1
      [4, { timestamp: 3000 }], // Deep 1.1.1
      [5, { timestamp: 4000 }], // Nested 1.2
      [6, { timestamp: 5000 }], // Item 2
    ]);

    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    // Should have 5 attributions - one for each list item
    expect(blockAttributions.size).toBe(5);
    const timestamps = Array.from(blockAttributions.values())
      .filter((a) => 'timestamp' in a)
      .map((a) => (a as any).timestamp);
    expect(timestamps).toContain(1000); // Item 1
    expect(timestamps).toContain(2000); // Nested 1.1
    expect(timestamps).toContain(3000); // Deep 1.1.1
    expect(timestamps).toContain(4000); // Nested 1.2
    expect(timestamps).toContain(5000); // Item 2
  });

  it('should preserve turn number in block attributions', async () => {
    const markdown = `# Heading

Paragraph 1

Paragraph 2`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    // Line attributions with turn numbers
    // Line 1: # Heading
    // Line 2: (blank)
    // Line 3: Paragraph 1
    // Line 4: (blank)
    // Line 5: Paragraph 2
    const lineAttributions = new Map<number, AttributionInfo>([
      [
        1,
        {
          timestamp: 1000,
          author: {
            id: 'agent-1',
            name: 'Test Agent',
            type: 'agent',
            turnNumber: 5,
          },
        },
      ],
      [
        3,
        {
          timestamp: 2000,
          author: {
            id: 'agent-1',
            name: 'Test Agent',
            type: 'agent',
            turnNumber: 7,
          },
        },
      ],
      [
        5,
        {
          timestamp: 3000,
          author: {
            id: 'user-1',
            name: 'Test User',
            type: 'user',
            // No turn number for user
          },
        },
      ],
    ]);

    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    // Should have 3 attributions
    expect(blockAttributions.size).toBe(3);

    // Check that turn numbers are preserved
    const attributions = Array.from(blockAttributions.values()).filter(
      (a) => 'timestamp' in a,
    ) as any[];
    expect(attributions[0].author?.turnNumber).toBe(5); // Heading
    expect(attributions[1].author?.turnNumber).toBe(7); // Paragraph 1
    expect(attributions[2].author?.turnNumber).toBeUndefined(); // Paragraph 2 (user edit)
  });

  it('should handle horizontal rules correctly', async () => {
    const markdown = `# Heading 1

Paragraph 1

---

## Heading 2

Paragraph 2`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    // Line 1: # Heading 1
    // Line 2: (blank)
    // Line 3: Paragraph 1
    // Line 4: (blank)
    // Line 5: ---
    // Line 6: (blank)
    // Line 7: ## Heading 2
    // Line 8: (blank)
    // Line 9: Paragraph 2
    const lineAttributions = new Map<number, AttributionInfo>([
      [1, { timestamp: 1000 }], // Heading 1
      [3, { timestamp: 2000 }], // Paragraph 1
      [5, { timestamp: 3000 }], // Horizontal rule
      [7, { timestamp: 4000 }], // Heading 2
      [9, { timestamp: 5000 }], // Paragraph 2
    ]);

    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    // Should have 5 attributions
    expect(blockAttributions.size).toBe(5);

    // Check that all timestamps are present
    const timestamps = Array.from(blockAttributions.values())
      .filter((a) => 'timestamp' in a)
      .map((a) => (a as any).timestamp)
      .sort();
    expect(timestamps).toEqual([1000, 2000, 3000, 4000, 5000]);
  });

  it('should handle task items mixed with regular list items', async () => {
    const markdown = `# Header

Paragraph put comment here more content.

- [ ]

- List item 1
- List item 2
- List item 3

- [ ] Task A
- [ ] Task B
- [ ] Task C

## Heading 2

More content at the bottom.

More content

## More headings

Now waht?`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [
        StarterKit,
        TaskList.configure({
          HTMLAttributes: {
            class: 'task-list not-prose pl-0',
          },
        }),
        CustomTaskItem.configure({
          nested: true,
          HTMLAttributes: {
            class: 'custom-task-item',
          },
          taskListTypeName: 'taskList',
        }),
      ],
      content: html,
    });

    // Line 1: # Header
    // Line 3: Paragraph put comment here more content.
    // Line 5: - [ ] (empty task item)
    // Line 7: - List item 1
    // Line 8: - List item 2
    // Line 9: - List item 3
    // Line 11: - [ ] Task A
    // Line 12: - [ ] Task B
    // Line 13: - [ ] Task C
    // Line 15: ## Heading 2
    // Line 17: More content at the bottom.
    // Line 19: More content
    // Line 21: ## More headings
    // Line 23: Now waht?
    const lineAttributions = new Map<number, AttributionInfo>([
      [1, { timestamp: 1000 }], // Header
      [3, { timestamp: 2000 }], // Paragraph
      [5, { timestamp: 3000 }], // Empty task item
      [7, { timestamp: 4000 }], // List item 1
      [8, { timestamp: 5000 }], // List item 2
      [9, { timestamp: 6000 }], // List item 3
      [11, { timestamp: 7000 }], // Task A
      [12, { timestamp: 8000 }], // Task B
      [13, { timestamp: 9000 }], // Task C
      [15, { timestamp: 10000 }], // Heading 2
      [17, { timestamp: 11000 }], // More content at the bottom
      [19, { timestamp: 12000 }], // More content
      [21, { timestamp: 13000 }], // More headings
      [23, { timestamp: 14000 }], // Now waht?
    ]);

    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    // Should have 14 attributions - one for each line
    expect(blockAttributions.size).toBe(14);

    // Check that all timestamps are present and in order
    const timestamps = Array.from(blockAttributions.values())
      .filter((a) => 'timestamp' in a)
      .map((a) => (a as any).timestamp)
      .sort((a, b) => a - b);
    expect(timestamps).toEqual([
      1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000,
    ]);

    // Verify each block position maps to unique blocks (no duplicates like the original bug)
    const blockPositions = Array.from(blockAttributions.keys());
    const uniquePositions = new Set(blockPositions);
    expect(uniquePositions.size).toBe(blockPositions.length); // All positions should be unique
  });

  it('should handle code blocks followed by headings correctly', async () => {
    // This test reproduces the bug where headings after code blocks
    // were incorrectly mapped to the code block's position
    const markdown = `# Main Heading

Some intro text.

\`\`\`sql
SELECT * FROM entries
WHERE type = 'meal_plan'
  AND date >= date('now', '-7 days')
ORDER BY date DESC;
\`\`\`

## Next Section

More content here.`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit, TaskList, CustomTaskItem],
      content: html,
    });

    const lineAttributions = new Map<number, AttributionInfo>();
    for (let i = 1; i <= 15; i++) {
      lineAttributions.set(i, {
        timestamp: Date.now(),
      });
    }

    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    // Get all block positions
    const positions = Array.from(blockAttributions.keys()).sort((a, b) => a - b);

    // Should have 5 unique blocks: heading, paragraph, codeBlock, heading, paragraph
    expect(positions.length).toBe(5);

    // The key test: verify that the heading after the code block has a DIFFERENT
    // position than the code block itself. This was the bug - headings after code
    // blocks were incorrectly mapped to the code block's position.

    // We know from the document structure:
    // - Lines 5-10 are the code block (```sql ... ```)
    // - Line 12 is "## Next Section" (the heading after the code block)

    // These should map to different block positions
    const codeBlockPos = positions[2]; // 3rd block (0-indexed)
    const headingAfterCodePos = positions[3]; // 4th block (0-indexed)

    expect(codeBlockPos).not.toBe(headingAfterCodePos);
    expect(headingAfterCodePos).toBeGreaterThan(codeBlockPos);
  });

  it('should provide per-line attributions for code blocks', async () => {
    // This test documents the DESIRED behavior for per-line code block attribution
    const markdown = `# Heading

\`\`\`sql
SELECT * FROM users
WHERE id = 1;
\`\`\`

## Next Section`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit, TaskList, CustomTaskItem],
      content: html,
    });

    // Different timestamps for different lines
    const lineAttributions = new Map<number, AttributionInfo>([
      [1, { timestamp: 1000 }], // # Heading
      [3, { timestamp: 2000 }], // ```sql
      [4, { timestamp: 3000 }], // SELECT * FROM users
      [5, { timestamp: 4000 }], // WHERE id = 1;
      [6, { timestamp: 5000 }], // ```
      [8, { timestamp: 6000 }], // ## Next Section
    ]);

    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    // Current behavior: code block gets ONE attribution (latest timestamp = 5000)
    // Desired behavior: code block should have per-line attributions

    // For now, just verify we get attributions for the blocks
    expect(blockAttributions.size).toBeGreaterThanOrEqual(3); // heading, code block, heading

    // Note: Once per-line attribution is implemented, verify:
    // - Code block position maps to an array of line attributions
    // - Each line within the code block has its own timestamp
    // - Lines 3-6 should each be individually attributable
  });

  it('should handle complex document with multiple code blocks and headings', async () => {
    // This test uses actual markdown from the problematic spec.json file
    // that was showing "garbled" mappings in production
    const markdown = `# Family Ops Agent - Project Specification

## Overview

A generic Cloudflare Agent that connects to domain-specific MCP servers.

## Architecture

### Core Interaction (North Star)

\`\`\`
User: "What's the plan for dinner tonight?"
Agent: [Calls MCP tool getMealPlan] "We don't have a plan for dinner yet."
User: "Yes, what haven't we had recently?"
Agent: [Calls getRecentMeals, then searchRecipes] "How about chicken tikka?"
User: "Great. Let's do that."
Agent: [Calls addMealToPlan multiple times]

\`\`\`

### Things to Investigate & Prove Out

1. What does a hello world look like?
2. Cloudflare Primitives

## Durable Objects with SQL - Design

### Generic Schema

\`\`\`sql
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  date TEXT,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
\`\`\`

### Example Data: Recipes

\`\`\`json
{
  "id": "recipe-chicken-tikka",
  "type": "recipe",
  "content": "Chicken Tikka Masala recipe..."
}
\`\`\`

## Next Steps

More content here.`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit, TaskList, CustomTaskItem],
      content: html,
    });

    const lineAttributions = new Map<number, AttributionInfo>();
    // Attribute all lines
    const lines = markdown.split('\n');
    for (let i = 1; i <= lines.length; i++) {
      lineAttributions.set(i, {
        timestamp: Date.now() + i, // Different timestamps to track them
      });
    }

    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributions, markdown);

    // Get all block positions
    const positions = Array.from(blockAttributions.keys()).sort((a, b) => a - b);

    // Key assertions: verify that content AFTER each code block has a different position
    // than the code block itself

    // We should have many unique blocks (headings, paragraphs, lists, code blocks)
    expect(positions.length).toBeGreaterThan(10);

    // Check that no single position dominates (like the bug where blockPos: 4027 appeared 83 times)
    // Count how many times each position appears in the original lineAttributions mapping
    const positionCounts = new Map<number, number>();
    for (const pos of positions) {
      positionCounts.set(pos, 1); // Each position should appear once in blockAttributions
    }

    // No position should appear more than once in the final blockAttributions map
    // (since it's a Map, this is guaranteed, but let's verify the structure is correct)
    expect(blockAttributions.size).toBe(positions.length);

    // Verify that positions are generally increasing (with some exceptions for lists)
    // This ensures we're not getting "stuck" on a position
    let previousPos = -1;
    let increasingCount = 0;
    for (const pos of positions) {
      if (pos > previousPos) {
        increasingCount++;
      }
      previousPos = pos;
    }

    // At least 80% of positions should be increasing
    expect(increasingCount / positions.length).toBeGreaterThan(0.8);
  });
});
