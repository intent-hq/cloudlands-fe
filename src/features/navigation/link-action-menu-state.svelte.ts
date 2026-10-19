/**
 * Singleton link action menu state.
 *
 * Shown when a GitHub issue/PR link is plain-clicked (see link-handler.ts).
 * Call `showLinkActionMenu` / `hideLinkActionMenu` from anywhere to control
 * it; the `LinkActionMenu.svelte` component (mounted in the root layout)
 * renders it.
 */

import type { PullRequestWorkspace } from '$lib/client/app-client';
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
  /** Element that triggered the menu; focus is restored to it on close. */
  anchorElement?: HTMLElement | null;
  /**
   * Workspaces the daemon linked to the clicked PR (`workspace.findByPullRequest`),
   * most recently linked first. Empty until the lookup for this opening resolves.
   */
  linkedWorkspaces: PullRequestWorkspace[];
  /** Identifies one opening of the menu; a lookup result for an older opening is dropped. */
  openingId: number;
}

export const linkActionMenuState = $state<LinkActionMenuState>({
  visible: false,
  url: '',
  gitHubRef: null,
  x: 0,
  y: 0,
  workspaceId: undefined,
  anchorElement: null,
  linkedWorkspaces: [],
  openingId: 0,
});

/**
 * Show the link action menu at the given position. Returns the opening id to
 * pass to {@link setLinkActionMenuLinkedWorkspaces}.
 */
export function showLinkActionMenu(params: {
  url: string;
  gitHubRef: GitHubIssueOrPrRef;
  x: number;
  y: number;
  workspaceId?: WorkspaceId;
  anchorElement?: HTMLElement | null;
}): number {
  linkActionMenuState.openingId += 1;
  linkActionMenuState.linkedWorkspaces = [];
  linkActionMenuState.url = params.url;
  linkActionMenuState.gitHubRef = params.gitHubRef;
  linkActionMenuState.x = params.x;
  linkActionMenuState.y = params.y;
  linkActionMenuState.workspaceId = params.workspaceId;
  linkActionMenuState.anchorElement = params.anchorElement ?? null;
  linkActionMenuState.visible = true;
  return linkActionMenuState.openingId;
}

/**
 * Apply a PR workspace lookup result, but only while the menu is still showing
 * the opening that requested it.
 */
export function setLinkActionMenuLinkedWorkspaces(
  openingId: number,
  workspaces: PullRequestWorkspace[],
): void {
  if (!linkActionMenuState.visible || linkActionMenuState.openingId !== openingId) return;
  linkActionMenuState.linkedWorkspaces = workspaces;
}

/** Hide the link action menu. */
export function hideLinkActionMenu(): void {
  linkActionMenuState.visible = false;
  linkActionMenuState.url = '';
  linkActionMenuState.gitHubRef = null;
  linkActionMenuState.workspaceId = undefined;
  linkActionMenuState.anchorElement = null;
  linkActionMenuState.linkedWorkspaces = [];
  linkActionMenuState.openingId += 1;
}
