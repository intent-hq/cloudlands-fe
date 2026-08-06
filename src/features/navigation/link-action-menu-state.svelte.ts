/**
 * Singleton link action menu state.
 *
 * Shown when a GitHub issue/PR link is plain-clicked (see link-handler.ts).
 * Call `showLinkActionMenu` / `hideLinkActionMenu` from anywhere to control
 * it; the `LinkActionMenu.svelte` component (mounted in the root layout)
 * renders it.
 */

import type { WorkspaceId } from '$shared/types/branded-ids';
import type { GitHubIssueOrPrRef } from '$shared/utils/link-helpers';

export interface LinkActionMenuState {
  visible: boolean;
  /** The clicked link URL. */
  url: string;
  /** Parsed GitHub issue/PR reference for the URL. */
  gitHubRef: GitHubIssueOrPrRef | null;
  /** Click position (viewport coordinates). */
  x: number;
  y: number;
  /** Workspace the click originated from; enables the in-app browser action. */
  workspaceId?: WorkspaceId;
}

export const linkActionMenuState = $state<LinkActionMenuState>({
  visible: false,
  url: '',
  gitHubRef: null,
  x: 0,
  y: 0,
  workspaceId: undefined,
});

/** Show the link action menu at the given position. */
export function showLinkActionMenu(params: {
  url: string;
  gitHubRef: GitHubIssueOrPrRef;
  x: number;
  y: number;
  workspaceId?: WorkspaceId;
}): void {
  linkActionMenuState.url = params.url;
  linkActionMenuState.gitHubRef = params.gitHubRef;
  linkActionMenuState.x = params.x;
  linkActionMenuState.y = params.y;
  linkActionMenuState.workspaceId = params.workspaceId;
  linkActionMenuState.visible = true;
}

/** Hide the link action menu. */
export function hideLinkActionMenu(): void {
  linkActionMenuState.visible = false;
  linkActionMenuState.url = '';
  linkActionMenuState.gitHubRef = null;
  linkActionMenuState.workspaceId = undefined;
}
