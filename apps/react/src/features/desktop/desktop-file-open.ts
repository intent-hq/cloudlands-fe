import { extractFilePathTarget, resolveFilePathTarget } from '$shared/utils/file-link-target';
import { isCmdClickModifier, type LinkHandlerOptions } from '$shared/utils/link-helpers';
import { store } from '@/store';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { selectCurrentWorkspaceTabId } from '@/store/tab-state/tab-state-selectors';
import { selectDesktopLayout } from '@/store/desktop/desktop-selectors';
import { workspaceRelativeFilePath } from '../../../../../src/features/file/utils/workspace-file-path';
import { createWorkspaceFileTab } from '../../../../../src/features/file/utils/workspace-file-tab';
import {
  openTab,
  openTabInAdjacentOrSplit,
  openTabInRightmostColumnRequested,
} from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';

/** DOM handlers supply their live row/view guard; canonical navigation owns reuse and placement. */
export function openDesktopFile(
  workspaceId: string,
  path: string,
  isCurrent: () => boolean,
  options?: {
    line?: number;
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
    filePathIsLiteral?: boolean;
  },
): boolean {
  if (
    !isCurrent() ||
    !selectAdmittedWorkspaceReadContext.select(store.state, workspaceId) ||
    selectCurrentWorkspaceTabId.select(store.state) !== workspaceId
  )
    return false;
  const workspace = selectWorkspaceById.select(store.state, workspaceId);
  const root = workspace?.worktreePath || workspace?.repositoryPath;
  const tab = createWorkspaceFileTab(workspaceId, path, options, Date.now());
  const relative = workspaceRelativeFilePath(tab.filePath, root);
  if (
    !root ||
    !relative ||
    (tab.data?.line !== undefined &&
      (!Number.isSafeInteger(tab.data.line) || Number(tab.data.line) < 1))
  )
    return false;
  const layout = selectDesktopLayout.select(store.state, workspaceId);
  const panelId = options?.sourcePanelId ?? layout.focusedPanelId ?? undefined;
  if (panelId && !layout.panels[panelId]) return false;
  // The shared root validator resolves the same file identity, never a filename guess.
  tab.filePath = relative;
  store.dispatch(
    options?.openInAdjacentPanel
      ? openTabInAdjacentOrSplit(workspaceId, tab, panelId, { force: true })
      : panelId
        ? openTab(workspaceId, tab, panelId, undefined, true)
        : openTabInRightmostColumnRequested(workspaceId, tab, { force: true }),
  );
  return true;
}

/** Source anchor classification, bounded to the admitted primary workspace root. */
export function openDesktopFileLink(
  workspaceId: string,
  url: string,
  options: LinkHandlerOptions,
  isCurrent: () => boolean,
): boolean {
  if (!isCurrent()) return false;
  const target = extractFilePathTarget(url, options.rawHref, window.location.origin);
  const workspace = selectWorkspaceById.select(store.state, workspaceId);
  const resolved =
    target && resolveFilePathTarget(target, workspace?.worktreePath || workspace?.repositoryPath);
  return (
    !!resolved &&
    resolved.kind === 'workspace' &&
    openDesktopFile(workspaceId, resolved.path, isCurrent, {
      filePathIsLiteral: true,
      line: resolved.line,
      sourcePanelId: options.sourcePanelId,
      openInAdjacentPanel: options.openInAdjacentPanel ?? isCmdClickModifier(options),
    })
  );
}
