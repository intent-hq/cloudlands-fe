import { afterAll, beforeAll, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { store } from '$store/renderer/configured-store';
import { createEditorConfig } from '$lib/utils/editor-config';
import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';
beforeAll(() => store.init());
afterAll(() => store.dispose());
const parts = [
  'plain START ' + 'café 🌍 repeated '.repeat(900) + ' plain END',
  'marked START **' + 'café 🌍 repeated '.repeat(900) + '** marked END',
  '- parent START\n' +
    Array.from({ length: 300 }, (_, i) => `  - child${i} café 🌍 repeated\n`).join('') +
    '- sibling END',
  '```text\n' +
    Array.from({ length: 900 }, (_, i) => `line${i} café 🌍 repeated\n`).join('') +
    'fenced END\n```',
  '| H | R |\n| --- | --- |\n' +
    Array.from({ length: 800 }, (_, i) => `| cell${i} café 🌍 | repeated |\n`)
      .join('')
      .trimEnd(),
  'following START ' + 'café 🌍 repeated '.repeat(900) + ' following END',
];
const source = parts.join('\n\n');
async function native(value: string) {
  return new Editor(
    createEditorConfig({
      element: document.createElement('div'),
      content: await processMarkdownToHTML(value),
      editable: true,
      useMarkdown: true,
      enableComments: false,
      enableMentions: false,
      onUpdate: () => {},
    }),
  );
}
for (let boundary = 0; boundary < 5; boundary++)
  for (const operation of ['Backspace', 'Delete', 'replace', 'text-input'] as const)
    it(`enlarged mixed boundary ${boundary} ${operation} keeps native canonical content`, async () => {
      const oracle = await native(source),
        backing = new SourceJournal(() => source, 1),
        session = new DocumentSession(backing, document.createElement('div'));
      try {
        const edge = parts.slice(0, boundary + 1).join('\n\n').length;
        await session.seek(edge + 2);
        let nativeEdge = 0;
        for (let i = 0; i <= boundary; i++) nativeEdge += oracle.state.doc.child(i).nodeSize;
        const left = TextSelection.near(oracle.state.doc.resolve(nativeEdge - 1), -1).head,
          right = TextSelection.near(oracle.state.doc.resolve(nativeEdge + 1), 1).head;
        const editor = session.editor!;
        expect(editor.state.doc.childCount).toBe(2);
        const boundedEdge = editor.state.doc.firstChild!.nodeSize;
        const boundedLeft = TextSelection.near(editor.state.doc.resolve(boundedEdge - 1), -1).head,
          boundedRight = TextSelection.near(editor.state.doc.resolve(boundedEdge + 1), 1).head;
        const nativeLeft = oracle.state.doc.resolve(left),
          nativeRight = oracle.state.doc.resolve(right),
          actualLeft = editor.state.doc.resolve(boundedLeft),
          actualRight = editor.state.doc.resolve(boundedRight);
        expect(actualLeft.parent.type.name).toBe(nativeLeft.parent.type.name);
        expect(actualRight.parent.type.name).toBe(nativeRight.parent.type.name);
        expect(
          actualLeft.parent.textContent.endsWith(nativeLeft.parent.textContent.slice(-20)),
        ).toBe(true);
        expect(
          actualRight.parent.textContent.startsWith(nativeRight.parent.textContent.slice(0, 20)),
        ).toBe(true);
        for (const [e, a, b] of [
          [oracle, left, right],
          [editor, boundedLeft, boundedRight],
        ] as const) {
          e.commands.setTextSelection(
            operation === 'replace' || operation === 'text-input'
              ? { from: a - 1, to: b + 1 }
              : operation === 'Backspace'
                ? b
                : a,
          );
          if (operation === 'replace') e.commands.insertContent('REPLACED café');
          else if (operation === 'text-input')
            e.view.dispatch(e.state.tr.insertText('REPLACED café'));
          else
            e.view.someProp('handleKeyDown', (f) =>
              f(
                e.view,
                new KeyboardEvent('keydown', { key: operation, bubbles: true, cancelable: true }),
              ),
            );
        }
        expect(session.error).toBe('');
        const edited = backing.region(0),
          canonical = processHTMLToMarkdown(oracle.getHTML());
        const fresh = await native(edited),
          canonicalOracle = await native(canonical);
        try {
          expect(fresh.getJSON()).toEqual(canonicalOracle.getJSON());
        } finally {
          fresh.destroy();
          canonicalOracle.destroy();
        }
        if (boundary > 0) expect(edited.startsWith(parts[0])).toBe(true);
        if (boundary < 4) expect(edited.endsWith(parts[5])).toBe(true);
        const old = session.editor!;
        session.save();
        await session.seek(session.selection.head);
        expect(old.isDestroyed).toBe(true);
        await session.history();
        expect(backing.region(0)).toBe(source);
        await session.history(true);
        expect(backing.region(0)).toBe(edited);
        expect(session.snapshot().mounted).toBe(1);
        expect(session.snapshot().cachePages).toBeLessThanOrEqual(4);
        expect(session.snapshot().maxSourceContextBytes).toBeLessThanOrEqual(16384);
      } finally {
        session.destroy();
        oracle.destroy();
      }
    });

for (const key of ['Backspace', 'Delete'] as const)
  it(`native full mixed ${key} records direct keyboard versus shortcut capture`, async () => {
    const captured = await native(source),
      direct = await native(source);
    try {
      let edge = 0;
      for (let i = 0; i <= 2; i++) edge += direct.state.doc.child(i).nodeSize;
      const at = TextSelection.near(
        direct.state.doc.resolve(key === 'Backspace' ? edge + 1 : edge - 1),
        key === 'Backspace' ? 1 : -1,
      ).head;
      captured.commands.setTextSelection(at);
      direct.commands.setTextSelection(at);
      captured.commands.keyboardShortcut(key);
      direct.view.someProp('handleKeyDown', (f) =>
        f(direct.view, new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
      );
      const describe = (e: Editor) => {
        const counts: Record<string, number> = {};
        e.state.doc.descendants((n) => {
          counts[n.type.name] = (counts[n.type.name] ?? 0) + 1;
        });
        return { counts, selection: e.state.selection.toJSON() };
      };
      const capturedReload = await native(processHTMLToMarkdown(captured.getHTML()));
      const directReload = await native(processHTMLToMarkdown(direct.getHTML()));
      console.log(
        'native-full-reload-control',
        JSON.stringify({
          key,
          captured: describe(capturedReload),
          direct: describe(directReload),
          capturedLiveTail: captured.state.doc.child(2).textContent.slice(-100),
          capturedFreshTail: capturedReload.state.doc.child(2).textContent.slice(-100),
          directLiveTail: direct.state.doc.child(2).textContent.slice(-100),
          directFreshTail: directReload.state.doc.child(2).textContent.slice(-100),
        }),
      );
      capturedReload.destroy();
      directReload.destroy();
      console.log(
        'native-full-dispatch-control',
        JSON.stringify({ key, captured: describe(captured), direct: describe(direct) }),
      );
      if (key === 'Delete') {
        expect(describe(direct)).toEqual(describe(captured));
        expect(direct.getJSON()).toEqual(captured.getJSON());
      } else {
        expect(describe(direct).counts.hardBreak).toBe(900);
        expect(describe(captured).counts.codeBlock).toBe(1);
        expect(describe(direct).counts.codeBlock).toBeUndefined();
      }
    } finally {
      captured.destroy();
      direct.destroy();
    }
  });
