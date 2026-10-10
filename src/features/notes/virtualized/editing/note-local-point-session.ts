import { sameNoteScope, type NoteSplice } from '$lib/client/note-pages';
import {
  type NoteDocumentSession,
  type NoteLocalPointEntry,
  type NoteLocalPointReplay,
} from './note-document-edit-session';
import {
  validateLocalPoint,
  type NoteLocalPointProof,
  type NoteLocalPointRecipe,
} from './note-local-point-history';

const uint = (n: number) => Number.isSafeInteger(n) && n >= 0;
function fail(): never {
  throw new Error('Unsupported local point session');
}
const copies = (splices: readonly Readonly<NoteSplice>[]) => {
  const result = splices.map((s) => Object.freeze({ ...s }));
  Object.freeze(result);
  return result;
};

/** Pure admission of one actual local native candidate. The runtime owner must
 * keep its proof and publish this generated group only after native acceptance. */
export function prepareNoteLocalPointSession(
  origin: NoteDocumentSession,
  recipe: NoteLocalPointRecipe,
  proof: NoteLocalPointProof,
) {
  if (
    origin.history.length ||
    origin.cursor ||
    origin.dirty.length ||
    origin.replay.length ||
    origin.length !== origin.baseLength ||
    !uint(origin.generation + 1) ||
    !sameNoteScope(origin.scope, recipe.identity.scope) ||
    origin.baseRevision !== recipe.identity.sourceRevision ||
    origin.generation !== recipe.identity.documentGeneration ||
    origin.baseLength !== recipe.baseLength ||
    origin.length !== recipe.beforeLength ||
    recipe.forward.length !== 1 ||
    recipe.inverse.length !== 1 ||
    !validateLocalPoint(proof, recipe, origin)
  )
    fail();
  const id = origin.generation + 1;
  const entry: NoteLocalPointEntry = Object.freeze({
    kind: 'local-point',
    id,
    beforeLength: origin.length,
    forward: copies(recipe.forward),
    inverse: copies(recipe.inverse),
    before: Object.freeze({ ...recipe.before }),
    after: Object.freeze({ ...recipe.after }),
    recipe,
  });
  const history = [entry];
  const replay: NoteLocalPointReplay[] = [
    Object.freeze({ kind: 'local-point', id, direction: 'redo', recipe }),
  ];
  Object.freeze(history);
  Object.freeze(replay);
  const state: NoteDocumentSession = Object.freeze({
    ...origin,
    scope: Object.freeze({ ...origin.scope }),
    limits: Object.freeze({ ...origin.limits }),
    generation: id,
    length: recipe.afterLength,
    cursor: 1,
    history,
    replay,
    dirty: entry.forward,
    selection: entry.after,
  });
  if (
    new TextEncoder().encode(JSON.stringify([history, replay, state.dirty])).length >
      origin.limits.retainedBytes / 2 ||
    origin.limits.historyEntries < 1 ||
    origin.limits.splices < 8 ||
    !validateLocalPoint(proof, recipe, origin)
  )
    fail();
  return { state, historyGroup: id, splices: entry.forward };
}

/** Local history only, retaining the actual inserted atom for redo. No receipt
 * source can create or replace the runtime proof required by this lane. */
export function moveNoteLocalPointSession(
  current: NoteDocumentSession,
  origin: NoteDocumentSession,
  recipe: NoteLocalPointRecipe,
  proof: NoteLocalPointProof,
  direction: 'undo' | 'redo',
) {
  const entry = current.history[0];
  const undo = direction === 'undo';
  if (
    current.history.length !== 1 ||
    entry?.kind !== 'local-point' ||
    entry.recipe !== recipe ||
    entry.id !== origin.generation + 1 ||
    current.cursor !== (undo ? 1 : 0) ||
    current.length !== (undo ? recipe.afterLength : recipe.beforeLength) ||
    !uint(current.generation + 1) ||
    current.generation < entry.id ||
    current.baseRevision !== origin.baseRevision ||
    current.baseLength !== origin.baseLength ||
    !sameNoteScope(current.scope, origin.scope) ||
    !validateLocalPoint(proof, recipe, origin)
  )
    fail();
  const dirty = undo ? [] : entry.forward;
  const replay: NoteLocalPointReplay[] = undo
    ? []
    : [Object.freeze({ kind: 'local-point', id: entry.id, direction, recipe })];
  Object.freeze(dirty);
  Object.freeze(replay);
  const state: NoteDocumentSession = Object.freeze({
    ...current,
    generation: current.generation + 1,
    cursor: undo ? 0 : 1,
    length: undo ? recipe.beforeLength : recipe.afterLength,
    dirty,
    replay,
    selection: undo ? entry.before : entry.after,
  });
  return { state, splices: undo ? entry.inverse : entry.forward };
}
