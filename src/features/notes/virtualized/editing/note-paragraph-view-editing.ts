import { UnsupportedParagraphEdit } from './note-paragraph-edit-authority';
import { sameNoteScope } from '$lib/client/note-pages';
import type { NoteTransactionOwner } from '../note-transaction-relay';
import type { NoteViewEditing } from '../note-window-view';
import { prepareNoteParagraphContext } from './note-paragraph-edit-context';
import { createReduxNoteDocumentOwner } from './note-document-redux-owner';
import { pageDocumentSelectionChanged } from '$store/renderer/slices/note-pages/note-pages-slice';

type ContextArgs = Parameters<typeof prepareNoteParagraphContext>;
type ContextTail = ContextArgs extends [unknown, ...infer Tail] ? Tail : never;
type EditingPort = ContextArgs[0] & {
  dispatch: Parameters<typeof createReduxNoteDocumentOwner>[2];
};

/** The document operation owner supplies history commands. Preparing a view does
 * not enable save/undo fallbacks or mint authority for an unsupported construct. */
export function prepareNoteParagraphViewEditing(
  args: [EditingPort, ...ContextTail],
  history: Pick<NoteViewEditing, 'undo' | 'redo'>,
) {
  const [port, window, panel, , now = Date.now] = args;
  const offer = prepareNoteParagraphContext(...args);
  const read = () =>
    port.read().byWorkspaceId[window.scope.workspaceId]?.notes[window.scope.noteId];
  const generation = read()?.generation;
  return {
    cancel: offer.cancel,
    release: offer.release,
    retire: offer.retire,
    ready: offer.ready
      .then((context): NoteViewEditing => {
        const guard = (owner: NoteTransactionOwner): NoteTransactionOwner => ({
          ...owner,
          current: () => context.current() && owner.current(),
          history(direction) {
            if (!context.current()) return undefined;
            const plan = owner.history?.(direction);
            return (
              plan && {
                ...plan,
                adopted: () => context.current() && plan.adopted(),
                current: () => context.current() && plan.current(),
                commit() {
                  if (!context.current()) throw new Error('Stale paragraph history');
                  plan.commit();
                },
              }
            );
          },
        });
        return {
          ...history,
          bind: () => undefined,
          borrow(target) {
            if (target !== window) throw new Error('Foreign paragraph view');
            const borrow = context.borrow();
            return {
              release: borrow.release,
              bind(target, projection, doc) {
                if (target !== window || !context.current())
                  throw new Error('Stale paragraph view');
                let base;
                try {
                  base = borrow.create(projection, doc);
                } catch (error) {
                  if (error instanceof UnsupportedParagraphEdit) return undefined;
                  throw error;
                }
                const owner = createReduxNoteDocumentOwner(base, read, port.dispatch);
                return guard(owner);
              },
            };
          },
          selectionChanged(selection) {
            const note = read();
            if (!context.current() || !note?.document || note.generation !== generation) return;
            port.dispatch(
              pageDocumentSelectionChanged(
                window.scope.workspaceId,
                window.scope.noteId,
                generation,
                note.document,
                selection,
              ),
            );
          },
        };
      })
      .catch((error): undefined => {
        const note = read();
        if (
          !(error instanceof UnsupportedParagraphEdit) ||
          note?.generation !== generation ||
          note?.status !== 'ready' ||
          note.needsReconcile ||
          note.windows[panel]?.value !== window ||
          !note.state ||
          note.state.sourceRevision !== window.sourceRevision ||
          !sameNoteScope(note.state.scope, window.scope) ||
          !window.expiresAt ||
          now() >= Date.parse(window.expiresAt)
        )
          throw error;
        // Read-only is a semantic outcome, never a fallback for failed authorization,
        // stale reads, transport errors or exhausted budgets.
        return undefined;
      }),
  };
}
