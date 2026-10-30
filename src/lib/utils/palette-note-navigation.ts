/** Open a global palette note only after its owning workspace is visible. */
import { store as appStore } from '$store/renderer/store';
import { openWorkspaceNote } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import { recordPaletteMruItem } from '$store/renderer/slices/palette/palette-slice';
import { openAndShowWorkspace, workspaceRoute } from './show-workspace.client';
import { createLogger } from './client-logger';

const logger = createLogger('PaletteNoteNavigation');

export async function openPaletteNote(
  workspaceId: string | undefined,
  noteId: string,
  openInAdjacentPanel: boolean,
): Promise<boolean> {
  if (!workspaceId) return false;
  const targetPath = workspaceRoute(workspaceId);
  if (window.location.pathname !== targetPath) {
    try {
      // Cancellation or a HUD no-op must not open a note in a hidden workspace.
      if (!(await openAndShowWorkspace(workspaceId))) return false;
    } catch (error) {
      logger.warn('Note workspace navigation failed', { workspaceId, error });
      return false;
    }
  }
  appStore.dispatch(openWorkspaceNote(workspaceId, noteId, { openInAdjacentPanel }));
  appStore.dispatch(
    recordPaletteMruItem('note', JSON.stringify([workspaceId, noteId]), Date.now()),
  );
  return true;
}
