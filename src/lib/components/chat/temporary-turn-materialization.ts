export type TemporaryTurnMaterializationKind = 'pinned' | 'editing';

export interface TemporaryTurnMaterialization {
  pinned: string | null;
  editing: string | null;
}

export const EMPTY_TEMPORARY_TURN_MATERIALIZATION: TemporaryTurnMaterialization = {
  pinned: null,
  editing: null,
};

export function materializeTurn(
  state: TemporaryTurnMaterialization,
  kind: TemporaryTurnMaterializationKind,
  turnKey: string,
): TemporaryTurnMaterialization {
  return state[kind] === turnKey ? state : { ...state, [kind]: turnKey };
}

export function releaseMaterializedTurn(
  state: TemporaryTurnMaterialization,
  kind: TemporaryTurnMaterializationKind,
  turnKey: string | null = state[kind],
): TemporaryTurnMaterialization {
  return turnKey !== null && state[kind] === turnKey ? { ...state, [kind]: null } : state;
}

export function isTurnTemporarilyMaterialized(
  state: TemporaryTurnMaterialization,
  turnKey: string,
): boolean {
  return state.pinned === turnKey || state.editing === turnKey;
}
