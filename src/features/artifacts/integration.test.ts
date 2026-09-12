import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { describe, expect, it, vi } from 'vitest';
import { parseAgentMessage } from '$lib/utils/messageParser';
import {
  NotesPrimitivesSerializer,
  serializePrimitiveToMarkdown,
} from '$lib/utils/notes-primitives-serializer';
import { ArtifactBlockNode } from '$lib/utils/tiptap-primitives/artifact-block-node';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { serializeArtifactBlock } from './model';

vi.mock('./ArtifactNodeView.svelte', () => ({ default: () => undefined }));

const reference = { noteId: 'note-1', artifactId: 'artifact-1' };
const serializer = new NotesPrimitivesSerializer();

describe('artifact fences across notes and chat', () => {
  it('renders the version-one agent guidance example in notes and chat', () => {
    // Public compatibility fixture from intentd agent-instructions/v2/common.md.
    const document = JSON.parse(
      '{"version":1,"id":"layout-options","title":"Choose a layout","kind":"options","items":[{"id":"compact","type":"card","text":"Compact: more room for content","x":24,"y":24,"width":220,"height":140},{"id":"spacious","type":"card","text":"Spacious: easier to scan","x":268,"y":24,"width":220,"height":140}],"connections":[],"annotations":[]}',
    );
    const markdown = '```ws-block:artifact\n' + JSON.stringify({ document }) + '\n```';
    expect(parseAgentMessage(markdown)).toContainEqual(
      expect.objectContaining({ type: 'artifact', metadata: { artifactData: { document } } }),
    );
    const parsed = serializer.parseMarkdown(markdown);
    expect(parsed).toHaveLength(1);
    expect(serializePrimitiveToMarkdown(parsed[0].primitive)).toBe(
      serializeArtifactBlock({ document }),
    );
  });

  it('accepts CRLF fences consistently in notes and chat', () => {
    const text = serializeArtifactBlock(reference).replace(/\n/g, '\r\n');
    expect(serializer.parseMarkdown(text)).toHaveLength(1);
    expect(parseAgentMessage(text).some((block) => block.type === 'artifact')).toBe(true);
  });

  it.each(['```', '~~~', '````'])(
    'renders a complete %s reference and preserves its identity through TipTap',
    (fence) => {
      const markdown = `${fence}ws-block:artifact\n${JSON.stringify(reference)}\n${fence}`;
      const chat = parseAgentMessage(markdown);
      expect(chat).toContainEqual(
        expect.objectContaining({ type: 'artifact', metadata: { artifactData: reference } }),
      );
      const parsed = serializer.parseMarkdown(markdown);
      expect(parsed).toHaveLength(1);
      const editor = new Editor({
        extensions: [
          Document,
          Paragraph,
          Text,
          ArtifactBlockNode.extend({
            addNodeView: () => () => ({ dom: window.document.createElement('div') }),
          }),
        ],
        content: { type: 'doc', content: [serializer.primitiveToTiptapNode(parsed[0].primitive)] },
      });
      const primitive = serializer.tiptapNodeToPrimitive(editor.getJSON().content![0]);
      expect(primitive?.type).toBe('artifact');
      expect(serializePrimitiveToMarkdown(primitive!)).toBe(serializeArtifactBlock(reference));
      editor.destroy();
    },
  );

  it('roundtrips inline documents through Markdown, HTML and TipTap without leaking note metadata', async () => {
    const block = {
      document: {
        version: 1 as const,
        id: 'inline',
        kind: 'board' as const,
        title: 'Board',
        items: [
          {
            id: 'x',
            type: 'text' as const,
            text: '<script>hello</script> `code`',
            x: 0,
            y: 0,
            width: 100,
            height: 80,
          },
        ],
        connections: [],
        annotations: [],
      },
    };
    const markdown = serializeArtifactBlock(block);
    const html = await processMarkdownToHTML(markdown, { processPrimitives: true });
    const editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        ArtifactBlockNode.extend({
          addNodeView: () => () => ({ dom: window.document.createElement('div') }),
        }),
      ],
      content: html,
    });
    const roundtrip = processHTMLToMarkdown(editor.getHTML());
    expect(parseAgentMessage(roundtrip)).toContainEqual(
      expect.objectContaining({ type: 'artifact', metadata: { artifactData: block } }),
    );
    expect(roundtrip).not.toContain('createdAt');
    editor.destroy();
  });

  it.each([
    '```ws-block:artifact\n{"noteId":',
    '```ws-block:artifact\n{"noteId":"n","artifactId":"a"}',
    '```ws-block:artifact\n{"document":{"version":99}}\n```',
    '```ws-block:artifact\n{"noteId":"n","artifactId":"a","workspaceId":"other"}\n```',
    '````ws-block:artifact\n{"noteId":"n","artifactId":"a"}\n```',
  ])('keeps malformed or incomplete fences inert: %s', (markdown) => {
    expect(parseAgentMessage(markdown).some((block) => block.type === 'artifact')).toBe(false);
    expect(serializer.parseMarkdown(markdown)).toEqual([]);
  });

  it('does not interpret artifact examples inside an outer code fence as notes', () => {
    const example = '````text\n' + serializeArtifactBlock(reference) + '\n````';
    expect(serializer.parseMarkdown(example)).toEqual([]);
    expect(parseAgentMessage(example).some((block) => block.type === 'artifact')).toBe(false);
  });
});
