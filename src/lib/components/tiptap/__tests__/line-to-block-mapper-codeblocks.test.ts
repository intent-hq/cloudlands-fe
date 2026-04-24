import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { mapLineAttributionsToBlocks } from '../line-to-block-mapper';

interface LineAttribution {
  line: number;
  timestamp: number;
}

const lowlight = createLowlight(common);

describe('Line to Block Mapper - Code Block Issues', () => {
  it('should handle headings after code blocks correctly', async () => {
    // Simplified version of the problematic markdown from the user's spec
    const markdown = `# Header

## Section 1

\`\`\`
Code line 1
Code line 2
Code line 3
\`\`\`

### Heading After Code Block

Paragraph after heading.`;

    // Create line attributions (one per non-blank line)
    const lineAttributions: LineAttribution[] = [
      { line: 1, timestamp: 1000 }, // # Header
      { line: 3, timestamp: 1001 }, // ## Section 1
      { line: 5, timestamp: 1002 }, // ```
      { line: 6, timestamp: 1003 }, // Code line 1
      { line: 7, timestamp: 1004 }, // Code line 2
      { line: 8, timestamp: 1005 }, // Code line 3
      { line: 9, timestamp: 1006 }, // ```
      { line: 11, timestamp: 1007 }, // ### Heading After Code Block
      { line: 13, timestamp: 1008 }, // Paragraph after heading
    ];

    // Convert markdown to HTML
    const html = await processMarkdownToHTML(markdown);

    // Create TipTap editor with the HTML
    const editor = new Editor({
      extensions: [
        StarterKit,
        CodeBlockLowlight.configure({
          lowlight,
        }),
      ],
      content: html,
    });

    // Convert line attributions array to Map
    const lineAttributionsMap = new Map(
      lineAttributions.map((attr) => [attr.line, { timestamp: attr.timestamp }]),
    );

    // Map line attributions to blocks
    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributionsMap, markdown);

    // Convert back to array for easier testing
    const blockAttributionsArray: Array<{
      line?: number;
      text: string;
      blockPos: number;
      finalPos: number;
    }> = [];

    for (const [pos, attrValue] of blockAttributions.entries()) {
      if (typeof attrValue === 'object' && 'type' in attrValue && attrValue.type === 'codeBlock') {
        // For code blocks, create one entry per line
        for (const lineAttr of attrValue.lines) {
          // Find the markdown line number for this attribution
          const lineNum = Array.from(lineAttributionsMap.entries()).find(
             
            ([_, attr]) => attr === lineAttr.attribution,
          )?.[0];
          const line = lineNum ? markdown.split('\n')[lineNum - 1] : '';
          blockAttributionsArray.push({
            line: lineNum,
            text: line,
            blockPos: pos - 1,
            finalPos: pos,
          });
        }
      } else {
        // Regular block
        const lineNum = Array.from(lineAttributionsMap.entries()).find(
           
          ([_, attr]) => attr === attrValue,
        )?.[0];
        const line = lineNum ? markdown.split('\n')[lineNum - 1] : '';
        blockAttributionsArray.push({
          line: lineNum,
          text: line,
          blockPos: pos - 1,
          finalPos: pos,
        });
      }
    }

    // Current behavior: code block lines all map to the same position,
    // so we get one attribution per block (not per line within code blocks)
    // Expected: 2 headings + 1 code block + 1 heading + 1 paragraph = 5 blocks
    expect(blockAttributionsArray.length).toBeGreaterThanOrEqual(5);

    // Verify each line has a unique block position (except code block lines which share one)

    // The heading after the code block should NOT have the same blockPos as the code block
    // Code block lines are 5-9, but now we have per-line attributions
    // So we should find any line from the code block (e.g., line 6, 7, or 8 - the content lines)
    const codeBlockAttr = blockAttributionsArray.find(
      (attr) => attr.line && attr.line >= 6 && attr.line <= 8,
    );
    const headingAfterCodeAttr = blockAttributionsArray.find((attr) => attr.line === 11);

    expect(headingAfterCodeAttr).toBeDefined();
    expect(codeBlockAttr).toBeDefined();
    expect(headingAfterCodeAttr!.blockPos).not.toBe(codeBlockAttr!.blockPos);
    expect(headingAfterCodeAttr!.blockPos).toBeGreaterThan(codeBlockAttr!.blockPos);

    editor.destroy();
  });

  it('should handle multiple code blocks with content between them', async () => {
    const markdown = `# Header

\`\`\`sql
SELECT * FROM table;
\`\`\`

### Section 1

Some text here.

\`\`\`json
{ "key": "value" }
\`\`\`

### Section 2

More text here.`;

    const lineAttributions: LineAttribution[] = [
      { line: 1, timestamp: 1000 }, // # Header
      { line: 3, timestamp: 1001 }, // ```sql
      { line: 4, timestamp: 1002 }, // SELECT * FROM table;
      { line: 5, timestamp: 1003 }, // ```
      { line: 7, timestamp: 1004 }, // ### Section 1
      { line: 9, timestamp: 1005 }, // Some text here.
      { line: 11, timestamp: 1006 }, // ```json
      { line: 12, timestamp: 1007 }, // { "key": "value" }
      { line: 13, timestamp: 1008 }, // ```
      { line: 15, timestamp: 1009 }, // ### Section 2
      { line: 17, timestamp: 1010 }, // More text here.
    ];

    const html = await processMarkdownToHTML(markdown);
    const editor = new Editor({
      extensions: [
        StarterKit,
        CodeBlockLowlight.configure({
          lowlight,
        }),
      ],
      content: html,
    });

    // Convert line attributions array to Map
    const lineAttributionsMap = new Map(
      lineAttributions.map((attr) => [attr.line, { timestamp: attr.timestamp }]),
    );

    const blockAttributions = mapLineAttributionsToBlocks(editor, lineAttributionsMap, markdown);

    // Convert back to array for easier testing
    const blockAttributionsArray = Array.from(blockAttributions.entries()).map(
      ([pos, attrInfo]) => {
        const lineNum = Array.from(lineAttributionsMap.keys()).find(
          (line) => lineAttributionsMap.get(line) === attrInfo,
        );
        const line = lineNum ? markdown.split('\n')[lineNum - 1] : '';
        return {
          line: lineNum,
          text: line,
          blockPos: pos - 1,
          finalPos: pos,
        };
      },
    );

    // Multiple code blocks test data available in blockAttributionsArray

    // Verify all headings and paragraphs have unique positions
    const section1Pos = blockAttributionsArray.find((attr) => attr.line === 7)?.blockPos;
    const section2Pos = blockAttributionsArray.find((attr) => attr.line === 15)?.blockPos;
    const text1Pos = blockAttributionsArray.find((attr) => attr.line === 9)?.blockPos;
    const text2Pos = blockAttributionsArray.find((attr) => attr.line === 17)?.blockPos;

    expect(section1Pos).not.toBe(section2Pos);
    expect(text1Pos).not.toBe(text2Pos);
    expect(section2Pos).toBeGreaterThan(section1Pos!);

    editor.destroy();
  });
});
