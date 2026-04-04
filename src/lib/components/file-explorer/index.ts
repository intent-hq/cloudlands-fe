export { default as FileExplorerLayout } from './file-explorer-layout.svelte';
export { default as FileExplorerSidebar } from './file-explorer-sidebar.svelte';
export { default as FileTreeView } from './file-tree-view.svelte';
export {
  createFileExplorerStore,
  getFileExplorerStore,
  clearFileExplorerStore,
  deactivateFileExplorerStore,
  reactivateFileExplorerStore,
} from './file-explorer-adapter';
export type { FlattenedFileNode } from '$lib/store/slices/file-explorer/file-explorer-types';
export type { FileNode } from '$shared/types';
