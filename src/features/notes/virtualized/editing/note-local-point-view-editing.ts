import type { NoteViewEditing } from '../note-window-view';
import { prepareNoteParagraphContext } from './note-paragraph-edit-context';
import { createNoteLocalPointOwner } from './note-local-point-owner';
import { prepareNoteDocumentPublication } from '$store/renderer/slices/note-pages/note-document-publication';
import { pageDocumentPublished } from '$store/renderer/slices/note-pages/note-pages-slice';

type Args = Parameters<typeof prepareNoteParagraphContext>;
type Port = Args[0] &
  Pick<Parameters<typeof createNoteLocalPointOwner>[0]['resources'], 'dispatch'> & {
    dispatch(action: ReturnType<typeof pageDocumentPublished>): void;
  };
type Tail = Args extends [unknown, ...infer T] ? T : never;

/** Explicit single-mount local producer. No detached editor, remount materializer,
 * canonical authority or reconstruction from a serialized local group. */
export function prepareNoteLocalPointViewEditing(args: [Port, ...Tail]) {
  const [port, window, panel, signal, now = Date.now] = args;
  const read = () =>
    port.read().byWorkspaceId[window.scope.workspaceId]?.notes[window.scope.noteId];
  const note = read(),
    origin = note?.document;
  if (
    !note ||
    !origin ||
    origin.history.length ||
    origin.dirty.length ||
    origin.replay.length ||
    origin.cursor ||
    origin.length !== origin.baseLength ||
    note.needsReconcile
  )
    throw new Error('Unsupported local point view');
  const generation = note.generation;
  const offer = prepareNoteParagraphContext(port, window, panel, signal, now);
  let owner: ReturnType<typeof createNoteLocalPointOwner> | undefined;
  let revoked = false,
    borrowed = false;
  let holdNative: (() => void) | undefined;
  const revoke = () => {
    revoked = true;
    owner?.dispose();
  };
  const ready = offer.ready.then((context): NoteViewEditing => ({
    bind: () => undefined,
    undo: () => {},
    redo: () => {},
    selectionChanged(selection) {
      const current = read()?.document;
      if (
        !current ||
        !(['anchor', 'head', 'anchorAffinity', 'headAffinity'] as const).every(
          (key) => current.selection[key] === selection[key],
        )
      )
        revoke();
    },
    borrow(target) {
      if (
        target !== window ||
        borrowed ||
        revoked ||
        read()?.document !== origin ||
        !context.current()
      )
        throw new Error('Local point view cannot remount');
      borrowed = true;
      const baseBorrow = context.borrow();
      let bound = false,
        released = false;
      return {
        initialSelection() {
          if (revoked || released || read()?.document !== origin || !context.current())
            throw new Error('Stale local point selection');
          return origin.selection;
        },
        bind(target, projection, doc, state) {
          if (
            bound ||
            released ||
            revoked ||
            target !== window ||
            !state ||
            state.doc !== doc ||
            !context.current() ||
            read()?.document !== origin
          )
            throw new Error('Stale local point binding');
          bound = true;
          const base = baseBorrow.create(projection, doc);
          const current = () => {
            const n = read();
            return !revoked &&
              n?.generation === generation &&
              n.status === 'ready' &&
              !n.needsReconcile &&
              n.state?.sourceRevision === origin.baseRevision
              ? n
              : undefined;
          };
          owner = createNoteLocalPointOwner({
            base,
            initialState: state,
            identity: {
              scope: window.scope,
              sourceRevision: window.sourceRevision,
              snapshotId: window.snapshotId,
              expiresAt: window.expiresAt ?? '',
              documentGeneration: origin.generation,
              liveGeneration: origin.generation,
              selectionGeneration: origin.generation,
            },
            read: () => current()?.document,
            publish(before, after, splices) {
              port.dispatch(
                pageDocumentPublished(
                  window.scope.workspaceId,
                  window.scope.noteId,
                  generation,
                  before,
                  after,
                  splices,
                ),
              );
            },
            admit(before, after, splices) {
              const n = current();
              return !!n && !!prepareNoteDocumentPublication(n, before, after, splices);
            },
            resources: { read: () => port.read().resourceLedger, dispatch: port.dispatch },
            context: {
              current: () => !revoked && context.current(),
              retain() {
                const borrow = context.borrow();
                return borrow.release;
              },
            },
            now,
          });
          const local = owner;
          let prepared = false,
            committed = false;
          return {
            get initial() {
              return local.initial;
            },
            current: local.current,
            prepare(transaction, before) {
              if (prepared || revoked) return undefined;
              const candidate = local.prepare(transaction, before);
              if (!candidate) return undefined;
              try {
                holdNative = local.retainPrepared(candidate, transaction);
                prepared = true;
                return candidate;
              } catch (error) {
                revoke();
                throw error;
              }
            },
            nativeOutput: local.nativeOutput,
            finalize: local.finalize,
            history: local.history,
            settled() {
              local.settled?.();
              if (prepared && !committed) revoke();
            },
            commit(chain) {
              local.commit(chain);
              committed = true;
            },
          };
        },
        retire: revoke,
        release() {
          if (released) return;
          released = true;
          revoke();
          holdNative?.();
          holdNative = undefined;
          owner = undefined;
          baseBorrow.release();
        },
      };
    },
  }));
  return {
    ready,
    cancel() {
      revoke();
      offer.cancel();
    },
    retire() {
      revoke();
      return offer.retire();
    },
    release() {
      revoke();
      return offer.release();
    },
    retain() {
      if (revoked || !owner) throw new Error('Local point session unavailable');
      return owner.retain();
    },
  };
}
