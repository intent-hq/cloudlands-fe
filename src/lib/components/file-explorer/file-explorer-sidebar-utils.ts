import type { FileExplorerTreeNode } from '$store/renderer/slices/file-explorer/file-explorer-types';

export type FileExplorerTreeNodeMap = Record<string, FileExplorerTreeNode>;

function nodeOrDescendantMatchesQuery(
  path: string,
  lowerQuery: string,
  nodesByPath: FileExplorerTreeNodeMap,
  visited: Set<string>,
): boolean {
  if (visited.has(path)) return false;
  visited.add(path);

  const node = nodesByPath[path];
  if (!node) return false;
  if (node.name.toLowerCase().includes(lowerQuery)) return true;

  return node.children.some((childPath) =>
    nodeOrDescendantMatchesQuery(childPath, lowerQuery, nodesByPath, visited),
  );
}

export function filterFileExplorerChildPaths(
  childPaths: readonly string[],
  query: string,
  nodesByPath: FileExplorerTreeNodeMap,
): string[] {
  if (!query) return childPaths.filter((childPath) => nodesByPath[childPath] !== undefined);

  const lowerQuery = query.toLowerCase();
  return childPaths.filter((childPath) =>
    nodeOrDescendantMatchesQuery(childPath, lowerQuery, nodesByPath, new Set()),
  );
}