import type { TransientUiState } from './transient-ui-slice';

export function getChatDraft(
  state: { transientUi: TransientUiState },
  workspaceId: string,
  agentId: string,
): string {
  return getChatDraftEntry(state, workspaceId, agentId) ?? '';
}

/** Presence distinguishes an intentional empty local edit from no mounted draft. */
export function getChatDraftEntry(
  state: { transientUi: TransientUiState },
  workspaceId: string,
  agentId: string,
): string | undefined {
  return state.transientUi.byWorkspaceId[workspaceId]?.chatDrafts[agentId];
}
