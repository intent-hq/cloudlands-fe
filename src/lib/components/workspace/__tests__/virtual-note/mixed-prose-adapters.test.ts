import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';

beforeAll(() => store.init());
afterAll(() => store.dispose());
const marker = '<!--anchor:cmt-mixed:start-->marked<!--anchor:cmt-mixed:end-->';
const fixtures = {
  'marker before fence': `before ${marker}\n\n\`\`\`text\nTARGET café 🌍\n\`\`\`\n\nfollowing`,
  'list before fence': '- parent\n  - child\n\n```text\nTARGET café 🌍\n```\n\nfollowing',
  'marker inside list': `before\n\n- ${marker} TARGET café 🌍\n  - child\n\nfollowing`,
  'multiple prose blocks after list':
    '- parent\n  - child\n\nfirst prose\n\n```text\nTARGET café 🌍\n```\n\nfollowing',
};
async function native(source: string) {
  const config = createEditorConfig({
    element: document.createElement('div'),
    content: '',
    editable: true,
    useMarkdown: true,
    enableComments: false,
    enableMentions: false,
    onUpdate: () => {},
  });
  return new Editor({
    ...config,
    extensions: [...config.extensions!, CommentAnchor],
    content: await processMarkdownToHTML(source, { preserveAnchors: true }),
  });
}
for (const [name, source] of Object.entries(fixtures)) {
  it(`routes exact mixed edits and live/fresh history for ${name}`, async () => {
    const control = await native(source);
    const service = new SourceJournal(() => source, 1);
    const session = new DocumentSession(service, document.createElement('div'));
    try {
      await session.show(0);
      let at = -1;
      control.state.doc.descendants((node, pos) => {
        if (node.isText && node.text!.includes('TARGET'))
          at = pos + node.text!.indexOf('TARGET') + 2;
      });
      expect(at).toBeGreaterThan(0);
      control.commands.setTextSelection(at);
      session.editor!.commands.setTextSelection(
        session.projection!.pmAt(source.indexOf('TARGET') + 2),
      );
      expect(session.editor!.getJSON()).toEqual(control.getJSON());
      expect(session.editor!.state.selection.toJSON()).toEqual(control.state.selection.toJSON());
      control.commands.insertContent('X');
      session.editor!.commands.insertContent('X');
      const edited = source.replace('TARGET', 'TAXRGET');
      expect(session.error).toBe('');
      expect(service.region(0)).toBe(edited);
      expect(session.editor!.getJSON()).toEqual(control.getJSON());
      const reopened = await native(edited);
      try {
        reopened.commands.setTextSelection(control.state.selection.head);
        expect(reopened.getJSON()).toEqual(control.getJSON());
      } finally {
        reopened.destroy();
      }
      const old = session.editor!;
      await session.seek(service.length - 1);
      expect(old.isDestroyed).toBe(true);
      control.commands.undo();
      await session.history();
      expect(service.region(0)).toBe(source);
      expect(session.editor!.getJSON()).toEqual(control.getJSON());
      expect(session.editor!.state.selection.toJSON()).toEqual(control.state.selection.toJSON());
      control.commands.redo();
      await session.history(true);
      expect(service.region(0)).toBe(edited);
      expect(session.editor!.getJSON()).toEqual(control.getJSON());
    } finally {
      session.destroy();
      control.destroy();
    }
  });
}
