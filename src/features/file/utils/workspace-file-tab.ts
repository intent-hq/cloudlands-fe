import { parseFilePathLineSuffix } from '$shared/utils/link-helpers';
import { m } from '$shared/paraglide/messages.js';
import type { PanelTab } from '../../../store/renderer/slices/panel-layout/panel-layout-types';

type FileOptions = {
  line?: number;
  filePathIsLiteral?: boolean;
  gitRootId?: string;
  gitRootPath?: string;
};

/** Source file navigation metadata; callers own admission and panel placement. */
export function createWorkspaceFileTab(
  workspaceId: string,
  filePath: string,
  options: FileOptions | undefined,
  now: number,
): Omit<PanelTab, 'id'> {
  const parsed = options?.filePathIsLiteral
    ? { path: filePath, line: undefined }
    : parseFilePathLineSuffix(filePath);
  const line = options?.line !== undefined ? options.line : parsed.line;
  return {
    type: 'file',
    title: parsed.path.split('/').pop() || m.layout_tabTypes_file_title(),
    filePath: parsed.path,
    workspaceId,
    closable: true,
    ...(line !== undefined || options?.gitRootId
      ? {
          data: {
            ...(line !== undefined ? { line, jumpTimestamp: now } : {}),
            ...(options?.gitRootId
              ? { gitRootId: options.gitRootId, gitRootPath: options.gitRootPath }
              : {}),
          },
        }
      : {}),
  };
}
