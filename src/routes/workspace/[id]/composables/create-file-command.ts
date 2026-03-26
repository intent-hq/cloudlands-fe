import { createFileRequested } from '$lib/store/slices/app-layout/app-layout-slice';

type CreateFileWorkspace = {
  id?: string | null;
  worktreePath?: string | null;
  repositoryPath?: string | null;
  path?: string | null;
};

type CreateFileDispatch = (action: ReturnType<typeof createFileRequested>) => void;

export function getCreateFileRootPath(workspace?: CreateFileWorkspace | null): string | null {
  return workspace?.worktreePath || workspace?.repositoryPath || workspace?.path || null;
}

export function handleCommandPaletteCreateFile(
  workspace: CreateFileWorkspace | null | undefined,
  onCreateFile: (folderPath: string) => void,
): boolean {
  const rootPath = getCreateFileRootPath(workspace);
  if (!rootPath) {
    return false;
  }

  onCreateFile(rootPath);
  return true;
}

export function dispatchCreateFileRequest(
  workspace: CreateFileWorkspace | null | undefined,
  folderPath: string,
  fileName: string,
  dispatch: CreateFileDispatch,
): boolean {
  if (!workspace?.id || !folderPath) {
    return false;
  }

  dispatch(createFileRequested(workspace.id, folderPath, fileName));
  return true;
}