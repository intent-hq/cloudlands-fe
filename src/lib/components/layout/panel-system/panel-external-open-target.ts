import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

export type PanelExternalOpenTarget =
  | { kind: 'browser'; url: string }
  | {
      kind: 'path';
      filePath: string;
      workspaceId: string;
      isDirectory: boolean;
      isDiff?: boolean;
      isWorkspaceRoot?: boolean;
      workspaceFolderPath?: string;
    }
  | { kind: 'unavailable'; reason: 'missing-resource' | 'remote' };

export function getPanelExternalOpenTarget(
  tab: PanelTab,
  fallbackWorkspaceId: string,
  isWorkspaceHostLocal: boolean,
): PanelExternalOpenTarget {
  if (tab.type === 'browser') {
    return tab.browserUrl
      ? { kind: 'browser', url: tab.browserUrl }
      : { kind: 'unavailable', reason: 'missing-resource' };
  }

  if (!isWorkspaceHostLocal) return { kind: 'unavailable', reason: 'remote' };

  const workspaceId = tab.workspaceId || fallbackWorkspaceId;
  if (!workspaceId) return { kind: 'unavailable', reason: 'missing-resource' };

  if (tab.type === 'file') {
    return tab.filePath
      ? { kind: 'path', filePath: tab.filePath, workspaceId, isDirectory: false }
      : { kind: 'unavailable', reason: 'missing-resource' };
  }
  if (tab.type === 'diff') {
    const filePath = tab.diffPath || tab.filePath;
    return filePath
      ? { kind: 'path', filePath, workspaceId, isDirectory: false, isDiff: true }
      : { kind: 'unavailable', reason: 'missing-resource' };
  }
  if (tab.type === 'note') {
    return tab.noteId
      ? {
          kind: 'path',
          filePath: `.workspace/notes/${tab.noteId}.md`,
          workspaceId,
          isDirectory: false,
          workspaceFolderPath: '__WORKSPACE_ROOT__',
        }
      : { kind: 'unavailable', reason: 'missing-resource' };
  }
  if (tab.type === 'agent') {
    return tab.agentId
      ? {
          kind: 'path',
          filePath: `.workspace/agents/${tab.agentId}.json`,
          workspaceId,
          isDirectory: false,
          workspaceFolderPath: '__WORKSPACE_ROOT__',
        }
      : { kind: 'unavailable', reason: 'missing-resource' };
  }

  return {
    kind: 'path',
    filePath: '.',
    workspaceId,
    isDirectory: true,
    isWorkspaceRoot: true,
    workspaceFolderPath: '__WORKSPACE_ROOT__',
  };
}
