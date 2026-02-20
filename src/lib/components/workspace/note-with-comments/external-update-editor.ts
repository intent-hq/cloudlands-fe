import type { LoggerLike } from './logger.types';

export type ExternalUpdateEditorLike = {
  getHTML: () => string;
  state: {
    selection?: { anchor?: number };
  };
  chain: () => {
    command: (fn: any) => any;
    setContent: (html: string) => any;
    run: () => void;
  };
};

export function applyExternalUpdateHtmlToEditorPreservingCursor({
  editor,
  html,
  cursorPos,
  createTextSelection,
  logger,
}: {
  editor: ExternalUpdateEditorLike;
  html: string;
  cursorPos?: number | null;
  createTextSelection: (doc: any, anchor: number, head?: number) => any;
  logger: LoggerLike;
}): boolean {
  const currentHtmlSnapshot = editor.getHTML();
  if (currentHtmlSnapshot === html) return false;

  const resolvedCursorPos =
    typeof cursorPos === 'number'
      ? cursorPos
      : typeof editor.state.selection?.anchor === 'number'
        ? (editor.state.selection.anchor as number)
        : null;

  editor
    .chain()
    .command((ctx: any) => {
      ctx.tr.setMeta('external-update', true);
      return true;
    })
    .setContent(html)
    .command((ctx: any) => {
      if (resolvedCursorPos !== null) {
        try {
          const maxPos = ctx.state.doc.content.size;
          const newPos = Math.min(resolvedCursorPos, maxPos);
          const resolvedPos = ctx.state.doc.resolve(newPos);
          ctx.tr.setSelection(createTextSelection(ctx.state.doc, resolvedPos.pos, resolvedPos.pos));
        } catch (e) {
          // Keep message stable: this same log line existed in NoteWithComments.svelte.
          logger.debug('[NoteWithComments] Could not restore cursor position', e);
        }
      }
      return true;
    })
    .run();

  return true;
}
