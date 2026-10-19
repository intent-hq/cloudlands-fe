/**
 * Loads the workspaces linked to a clicked PR link for the link action menu
 * ("Open in Original Workspace"). The daemon owns the PR <-> workspace links
 * (`workspace.findByPullRequest`, PROTOCOL §5.1); this only fetches them for
 * one menu opening and drops the result if that opening is gone.
 */

import { appClient } from '$lib/client';
import { Logger } from '$shared/logger';
import { selectPrincipalSnapshot } from '$store/renderer/slices/principal/principal-selectors';
import { store as appStore } from '$store/renderer/store';
import { setLinkActionMenuLinkedWorkspaces } from './link-action-menu-state.svelte';

const logger = new Logger('LinkActionMenuLinkedWorkspaces');

/**
 * Look up the workspaces linked to `url` and hand them to the menu opening
 * `openingId`. Does nothing unless the connected daemon advertises
 * `prWorkspaceLookup: 1`; a failed lookup leaves the menu unchanged.
 */
export async function loadLinkActionMenuLinkedWorkspaces(
  openingId: number,
  url: string,
): Promise<void> {
  if (selectPrincipalSnapshot.select(appStore.state)?.capabilities.prWorkspaceLookup !== 1) {
    return;
  }
  try {
    const workspaces = await appClient.workspaces.findByPullRequest(url);
    setLinkActionMenuLinkedWorkspaces(openingId, workspaces);
  } catch (error) {
    logger.debug('PR workspace lookup failed', { url, error });
  }
}
