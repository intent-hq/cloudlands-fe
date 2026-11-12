/**
 * The editor's draft (Capture and recording editor spec): edits are a draft until
 * Save changes; Cancel throws them away. Undo and redo work across every edit while
 * the editor is open, and Reset edits is an ordinary, undoable change.
 */
export interface EditTransaction<T> {
  readonly draft: T;
  /** The draft differs from what was saved. */
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  apply(next: T | ((draft: T) => T)): void;
  undo(): void;
  redo(): void;
  /** Back to `original` (as captured), as one undoable change. */
  reset(original: T): void;
  /** The draft to save; after a successful save, `saved` is the new baseline. */
  commit(saved: T): void;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function createEditTransaction<T>(saved: T): EditTransaction<T> {
  let baseline = $state.raw(saved);
  let draft = $state.raw(saved);
  let past = $state.raw<T[]>([]);
  let future = $state.raw<T[]>([]);
  const set = (next: T) => {
    if (same(next, draft)) return;
    past = [...past, draft];
    future = [];
    draft = next;
  };
  return {
    get draft() {
      return draft;
    },
    get dirty() {
      return !same(draft, baseline);
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    apply(next) {
      set(typeof next === 'function' ? (next as (value: T) => T)(draft) : next);
    },
    undo() {
      const previous = past.at(-1);
      if (previous === undefined) return;
      past = past.slice(0, -1);
      future = [draft, ...future];
      draft = previous;
    },
    redo() {
      const next = future[0];
      if (next === undefined) return;
      future = future.slice(1);
      past = [...past, draft];
      draft = next;
    },
    reset(original) {
      set(original);
    },
    commit(value) {
      baseline = value;
      draft = value;
      past = [];
      future = [];
    },
  };
}
