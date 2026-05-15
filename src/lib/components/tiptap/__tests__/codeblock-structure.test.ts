/**
 * @vitest-environment jsdom
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';

describe('Code Block Structure Investigation', () => {
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

  it('should investigate ProseMirror code block internal structure', async () => {
    const markdown = `# Heading

\`\`\`sql
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  date TEXT
);
\`\`\`

## Next`;

    const html = await processMarkdownToHTML(markdown);
    editor = new Editor({
      element: document.body.querySelector('div')!,
      extensions: [StarterKit],
      content: html,
    });

    const structure: any[] = [];

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    editor.state.doc.descendants((node, pos, parent) => {
      const info: any = {
        type: node.type.name,
        pos,
        textContent: node.textContent.substring(0, 50),
        childCount: node.childCount,
      };

      if (node.type.name === 'codeBlock') {
        info.children = [];
        node.descendants((child, childPos) => {
          const childInfo = {
            type: child.type.name,
            relativePos: childPos,
            absolutePos: pos + childPos + 1, // +1 because we're inside the parent
            text: child.text || child.textContent,
            isText: child.isText,
          };
          info.children.push(childInfo);
        });
      }

      structure.push(info);
      return true;
    });

    // Find the code block
    const codeBlock = structure.find((n) => n.type === 'codeBlock');
    expect(codeBlock).toBeDefined();

    // Check if code block has child nodes
    // The key question: does ProseMirror represent each line as a separate node?
    // Or is it just one big text node?
    if (codeBlock.children && codeBlock.children.length > 0) {
      // Code block HAS child nodes
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      codeBlock.children.forEach((child: any, i: number) => {
        // Child nodes exist
      });
    } else {
      // Code block has NO child nodes - it's a single text node
    }
  });
});
