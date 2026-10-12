import type { ScriptsState, ScriptWithState } from './scripts-types';
import { emptyWorkspaceState } from './scripts-slice';

type ScriptsProjectionState = { scripts: ScriptsState };

export function getScriptsWorkspaceState(
  state: ScriptsProjectionState,
  wsId: string | null | undefined,
) {
  if (!wsId) return emptyWorkspaceState;
  return state.scripts.byWorkspaceId[wsId] ?? emptyWorkspaceState;
}

export const getAllWorkspaceScriptEntries = (
  state: ScriptsProjectionState,
  wsId: string,
): ScriptWithState[] => Object.values(getScriptsWorkspaceState(state, wsId).scripts);
