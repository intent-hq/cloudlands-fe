/** Open a global palette note only after its owning workspace is visible. */
import { store as appStore } from '$store/renderer/store';
import { openWorkspaceNote } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import { recordPaletteMruItem } from '$store/renderer/slices/palette/palette-slice';
import { navigateToRoute } from './navigation.client';
import { createLogger } from './client-logger';

const logger = createLogger('PaletteNoteNavigation');

export async function openPaletteNote(
  workspaceId: string | undefined,
  noteId: string,
  openInAdjacentPanel: boolean,
): Promise<boolean> {
  if (!workspaceId) return false;
  const targetPath = `/workspace/${encodeURIComponent(workspaceId)}`;
  if (window.location.pathname !== targetPath) {
    try {
      await navigateToRoute(targetPath);
    } catch (error) {
      logger.warn('Note workspace navigation failed', { workspaceId, error });
      return false;
    }
    // Cancellation or a HUD no-op must not open a note in a hidden workspace.
    if (window.location.pathname !== targetPath) return false;
  }
  appStore.dispatch(openWorkspaceNote(workspaceId, noteId, { openInAdjacentPanel }));
  appStore.dispatch(
    recordPaletteMruItem('note', JSON.stringify([workspaceId, noteId]), Date.now()),
  );
  return true;
}
