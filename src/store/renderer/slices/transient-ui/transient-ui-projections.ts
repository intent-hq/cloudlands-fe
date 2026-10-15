import type { TransientUiState } from './transient-ui-slice';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';

export function getComposerContextEntry(
  state: { transientUi: TransientUiState },
  workspaceId: string,
  agentId: string,
) {
  const items = state.transientUi.byWorkspaceId[workspaceId]?.composerContextByAgentId[agentId];
  return items ? getItems(items) : undefined;
}

export function getComposerContextItems(
  state: { transientUi: TransientUiState },
  workspaceId: string,
  agentId: string,
) {
  return getComposerContextEntry(state, workspaceId, agentId) ?? [];
}

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
