// i18n-ignore (internal local node-view exercise controls and document)
import { StrictMode, useState } from 'react';
import { Node, type JSONContent } from '@tiptap/core';
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Button } from '@/components/ui/button';
import { ChoiceBlockNodeView } from '@/components/tiptap/choice-block-node-view';
import { ChoiceQuestionNodeView } from '@/components/tiptap/choice-question-node-view';
import '$lib/styles/tiptap-editor.css';

const PreviewQuestion = Node.create({
  name: 'previewQuestion',
  content: 'paragraph',
  renderHTML: () => ['div', { 'data-preview-question': '' }, 0],
  addNodeView: () => ReactNodeViewRenderer(ChoiceQuestionNodeView),
});
const PreviewBlock = Node.create({
  name: 'previewBlock',
  group: 'block',
  content: 'previewQuestion paragraph*',
  renderHTML: () => ['div', { 'data-preview-block': '' }, 0],
  addNodeView: () => ReactNodeViewRenderer(ChoiceBlockNodeView),
});
const initialDocument: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Before the choice' }] },
    {
      type: 'previewBlock',
      content: [
        {
          type: 'previewQuestion',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Which project should we open?' }],
            },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Local example content' }] },
      ],
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'After the choice' }] },
  ],
};

function LocalChoiceEditor() {
  const [snapshot, setSnapshot] = useState({ document: initialDocument, changes: 0 });
  const [readOnly, setReadOnly] = useState(false);
  const editor = useEditor({
    extensions: [StarterKit, PreviewBlock, PreviewQuestion],
    immediatelyRender: false,
    content: initialDocument,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': 'Choice node-view editor',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: current }) =>
      setSnapshot((previous) => ({ document: current.getJSON(), changes: previous.changes + 1 })),
  });
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!editor}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          Undo choice change
        </Button>
        <Button
          variant="outline"
          disabled={!editor}
          aria-pressed={readOnly}
          onClick={() => {
            editor?.setEditable(readOnly);
            setReadOnly(!readOnly);
          }}
        >
          Read-only editor
        </Button>
      </div>
      <div data-testid="choice-editor-frame" className="min-w-0">
        <EditorContent editor={editor} />
      </div>
      <output aria-label="Choice editor document" className="min-w-0 break-all">
        {JSON.stringify(snapshot)}
      </output>
    </>
  );
}

export function ChoiceEditorExamples() {
  const [shown, setShown] = useState(true);
  return (
    <section className="grid min-w-0 w-full gap-4" data-testid="choice-editor-demo">
      <header>
        <h2>Choice editor views</h2>
        <p className="type-caption text-muted-foreground">
          Internal local node-view exercise · unreleased
        </p>
      </header>
      <p className="type-caption text-muted-foreground">
        This local editor exercises the saved views. Production choice options and commands remain
        unported.
      </p>
      <Button variant="outline" aria-pressed={shown} onClick={() => setShown(!shown)}>
        Mount choice editor
      </Button>
      {shown && (
        <StrictMode>
          <LocalChoiceEditor />
        </StrictMode>
      )}
    </section>
  );
}
