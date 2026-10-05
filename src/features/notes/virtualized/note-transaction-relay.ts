import type { NoteSourceSelection } from './note-source-selection';
import type { NoteViewCoordinates } from './note-view-coordinates';
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Selection,
  type Transaction,
} from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import type { SourceProjection } from './projection/source-projection';
import { measureNoteProjection } from './note-view-cost';

interface Candidate {
  readonly doc: PMNode;
  readonly projection: SourceProjection;
  readonly coordinates?: NoteViewCoordinates;
}

/** A mounted document owner's pure preparation and synchronous accepted-chain adoption.
 * Neither binding nor preparation may publish drafts, selection, history or source writes. */
export interface NoteTransactionOwner {
  readonly initial: Candidate;
  current(): boolean;
  /** Pure document-history admission; native adoption is owned by the view. */
  history?(direction: 'undo' | 'redo'):
    | {
        initial: Candidate;
        selection: NoteSourceSelection;
        current(): boolean;
        adopted(): boolean;
        commit(): void;
      }
    | undefined;
  prepare(transaction: Transaction, before: Candidate): Candidate | undefined;
  /** Pure final selection/history preparation. Must preserve the exact accepted
   * document and projection; refusal still precedes external owner adoption. */
  finalize?(after: Candidate, selection: Selection): Candidate | undefined;
  /** Called only after native application, once for the complete accepted chain.
   * The owner must coalesce its history and must not reject during adoption. */
  commit(chain: {
    before: Candidate;
    after: Candidate;
    transactions: readonly Transaction[];
    selection: Selection;
  }): void;
}

interface Prepared {
  owner: NoteTransactionOwner;
  before: Candidate;
  after: Candidate;
  cost: ReturnType<typeof measureNoteProjection>;
}
interface Provisional {
  owner: NoteTransactionOwner;
  candidate: Candidate;
}

/** ProseMirror filters can run before another plugin rejects a transaction. Keep
 * their results private until TipTap reports the actual accepted transaction chain. */
export function createNoteTransactionRelay(getOwner: () => NoteTransactionOwner | undefined) {
  const key = new PluginKey<Provisional | undefined>('noteDocumentTransaction');
  const prepared = new WeakMap<Transaction, Prepared>();
  const finalized = new WeakMap<Candidate, Candidate>();
  let busy = false;
  let unowned = false;
  let commitStarted = false;
  let adopted = false;
  const deferred = new Map<'owner' | 'window' | 'selection' | 'destroy' | 'history', () => void>();
  const pending: Array<{
    transaction: Transaction;
    next: (tr: Transaction) => void;
    owner: NoteTransactionOwner | undefined;
  }> = [];
  const refuseAdoption = () => {
    unowned = true;
    return undefined;
  };
  const current = (owner: NoteTransactionOwner) => {
    try {
      return getOwner() === owner && owner.current();
    } catch {
      return false;
    }
  };
  const candidateAt = (state: EditorState, owner: NoteTransactionOwner) => {
    const local = key.getState(state);
    const candidate = local?.owner === owner ? local.candidate : owner.initial;
    return finalized.get(candidate) ?? candidate;
  };
  const plugin = new Plugin<Provisional | undefined>({
    key,
    state: {
      init: () => undefined,
      apply(transaction, previous) {
        if (!transaction.docChanged) return previous;
        const plan = prepared.get(transaction);
        return plan ? { owner: plan.owner, candidate: plan.after } : undefined;
      },
    },
    filterTransaction(transaction, state) {
      if (!transaction.docChanged) return true;
      prepared.delete(transaction);
      const owner = getOwner();
      // Enforce the existing mounted-view budget before native acceptance, not
      // after adopting the document owner's history/source changes.
      try {
        if (!owner || !current(owner)) return false;
        const before = candidateAt(state, owner);
        if (!before.doc.eq(state.doc)) return false;
        const after = owner.prepare(transaction, before);
        if (!after || !after.doc.eq(transaction.doc) || !current(owner)) return false;
        const cost = measureNoteProjection(after.projection);
        prepared.set(transaction, { owner, before, after, cost });
      } catch {
        return false;
      }
      return true;
    },
  });
  return {
    plugin,
    get busy() {
      return busy;
    },
    /** Plugins inspecting the provisional native state must use its matching map. */
    projectionAt(state: EditorState) {
      const local = key.getState(state);
      if (local?.candidate.doc.eq(state.doc)) return local.candidate.projection;
      const initial = getOwner()?.initial;
      return initial?.doc.eq(state.doc) ? initial.projection : undefined;
    },
    coordinatesAt(state: EditorState) {
      const local = key.getState(state);
      if (local?.candidate.doc.eq(state.doc)) return local.candidate.coordinates;
      const initial = getOwner()?.initial;
      return initial?.doc.eq(state.doc) ? initial.coordinates : undefined;
    },
    /** Coalesce bounded view lifecycle intents until application/adoption finishes. */
    defer(kind: 'owner' | 'window' | 'selection' | 'destroy' | 'history', action: () => void) {
      if (!busy) return false;
      deferred.set(kind, action);
      return true;
    },
    /** Wrap the actual TipTap dispatch, including plugin view updates and owner
     * callbacks. Nested dispatch cannot overtake adoption or overwrite its map. */
    dispatch(transaction: Transaction, next: (tr: Transaction) => void, editor: Editor) {
      // Refuse excess reentrant work; never retain a document-sized dispatch queue.
      if (pending.length >= 32) return;
      pending.push({ transaction, next, owner: getOwner() });
      if (busy) return;
      let processed = 0;
      try {
        while (pending.length && processed++ < 32) {
          const work = pending.shift();
          if (!work) break;
          if (editor.isDestroyed) break;
          if (work.owner !== getOwner() || !work.transaction.before.eq(editor.state.doc)) continue;
          const committed = editor.state;
          busy = true;
          unowned = false;
          commitStarted = false;
          adopted = false;
          let failed = false;
          let failure: unknown;
          const recordFailure = (error: unknown) => {
            failure = failed
              ? new AggregateError(
                  [failure, error],
                  // i18n-ignore (internal diagnostic; the view displays a localized error)
                  'Native note dispatch cleanup failed',
                  { cause: failure },
                )
              : error;
            failed = true;
          };
          try {
            work.next(work.transaction);
          } catch (error) {
            recordFailure(error);
          } finally {
            try {
              if (!editor.isDestroyed && (unowned || (failed && !commitStarted))) {
                // Includes a plugin throwing after native state update but before
                // owner adoption. Restore only when no owner commit has begun.
                editor.view.updateState(committed);
              } else if (!editor.isDestroyed && failed && commitStarted && !adopted) {
                // A throwing owner violates the synchronous commit contract. Its
                // source outcome is uncertain; retire rather than roll it back.
                editor.destroy();
              }
            } catch (error) {
              recordFailure(error);
              try {
                editor.destroy();
              } catch (retirementError) {
                recordFailure(retirementError);
              }
            } finally {
              busy = false;
              if (unowned || failed) pending.length = 0;
            }
          }
          if (failed) throw failure;
          const destroy = deferred.get('destroy');
          const actions = destroy ? [destroy] : [...deferred.values()];
          deferred.clear();
          for (const action of actions) action();
        }
      } catch (error) {
        const destroy = deferred.get('destroy');
        deferred.clear();
        pending.length = 0;
        busy = false;
        // Unmount owns observer/window retirement even when the native dispatch
        // failed. Other deferred actions must not bind against failed state.
        try {
          destroy?.();
        } catch (cleanup) {
          throw new AggregateError([error, cleanup], 'Native note retirement failed', {
            cause: error,
          });
        }
        throw error;
      } finally {
        pending.length = 0;
        deferred.clear();
        busy = false;
      }
    },
    /** Selection comes from the final EditorState, including appended transactions. */
    adopt(transactions: readonly Transaction[], state: EditorState) {
      let first: Prepared | undefined;
      let last: Prepared | undefined;
      for (const transaction of transactions) {
        if (!transaction.docChanged) continue;
        const plan = prepared.get(transaction);
        if (!plan || !current(plan.owner)) return refuseAdoption();
        if (last && (last.owner !== plan.owner || last.after !== plan.before))
          return refuseAdoption();
        first ??= plan;
        last = plan;
      }
      if (!first || !last) return undefined;
      const final = key.getState(state);
      if (
        final?.owner !== last.owner ||
        final.candidate !== last.after ||
        !last.after.doc.eq(state.doc)
      )
        return refuseAdoption();
      // Delete before the callback so a reentrant/repeated notification cannot adopt twice.
      for (const transaction of transactions) prepared.delete(transaction);
      let after = last.after;
      try {
        if (first.owner.finalize) {
          const candidate = first.owner.finalize(after, state.selection);
          if (
            !candidate ||
            candidate.doc !== after.doc ||
            candidate.projection !== after.projection ||
            candidate.coordinates !== after.coordinates
          )
            return refuseAdoption();
          after = candidate;
        }
        if (!current(first.owner)) return refuseAdoption();
      } catch {
        return refuseAdoption();
      }
      commitStarted = true;
      first.owner.commit({
        before: first.before,
        after,
        transactions,
        selection: state.selection,
      });
      adopted = true;
      finalized.set(last.after, after);
      return {
        projection: last.after.projection,
        coordinates: last.after.coordinates,
        cost: last.cost,
      };
    },
  };
}
