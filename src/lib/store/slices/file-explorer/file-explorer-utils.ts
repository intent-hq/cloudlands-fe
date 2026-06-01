/**
 * Pure utility functions for file explorer tree operations.
 * No store, service, or side-effect dependencies.
 */
import type { FileNode } from "$shared/types";
import type { FlattenedFileNode, FileExplorerTreeNode } from "./file-explorer-types";
import { stripWorkspacePrefix } from "$lib/utils/file-utils";
import ignore from "ignore";
import {
  getItem,
  type Collection,
} from "svelte-redux-toolkit/utils/collections/collection-utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ALWAYS_HIDE = new Set([".git"]);

export const DEFAULT_IGNORE_PATTERNS = [
  "node_modules",
  ".DS_Store",
  "Thumbs.db",
  "dist",
  "build",
  ".next",
  ".svelte-kit",
  "coverage",
  ".cache",
  "*.log",
];

// ---------------------------------------------------------------------------
// Gitignore helpers
// ---------------------------------------------------------------------------

let cachedPatternsRef: string[] | null = null;
let cachedIg: ReturnType<typeof ignore> | null = null;

export function getIgnoreInstance(patterns: string[]): ReturnType<typeof ignore> {
  if (cachedPatternsRef === patterns && cachedIg) return cachedIg;
  cachedPatternsRef = patterns;
  cachedIg = ignore();
  cachedIg.add(DEFAULT_IGNORE_PATTERNS);
  if (patterns.length > 0) {
    cachedIg.add(patterns);
  }
  return cachedIg;
}

export function shouldHide(filePath: string): boolean {
  const lastSlash = filePath.lastIndexOf("/");
  const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  return ALWAYS_HIDE.has(fileName);
}

export function checkGitignored(
  filePath: string,
  workspacePath: string,
  gitignorePatterns: string[],
): boolean {
  const stripped = stripWorkspacePrefix(filePath, workspacePath);
  const lastSlash = filePath.lastIndexOf("/");
  const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  const relativePath = stripped !== filePath ? stripped : fileName;
  const ig = getIgnoreInstance(gitignorePatterns);
  return ig.ignores(relativePath);
}

// ---------------------------------------------------------------------------
// Tree traversal & immutable update helpers
// ---------------------------------------------------------------------------

export function findNodeByPath(
  rootNode: FileNode | null,
  workspacePath: string,
  targetPath: string,
): FileNode | null {
  if (!rootNode) return null;
  if (targetPath === workspacePath || targetPath === rootNode.path) return rootNode;

  const stripped = stripWorkspacePrefix(targetPath, workspacePath);
  const relativePath = stripped !== targetPath ? stripped : targetPath;
  if (!relativePath) return null;

  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  let currentNode = rootNode;
  for (const segment of segments) {
    const childNode = currentNode.children?.find((child) => child.name === segment);
    if (!childNode) return null;
    currentNode = childNode;
  }
  return currentNode;
}

/**
 * Immutably set children at a given path in the tree.
 * Returns a new tree root with only the path nodes cloned.
 */
export function setChildrenAtPath(
  root: FileNode,
  targetPath: string,
  children: FileNode[],
): FileNode {
  if (root.path === targetPath) {
    return { ...root, children };
  }
  if (!root.children) return root;
  return {
    ...root,
    children: root.children.map((child) =>
      targetPath.startsWith(child.path + "/") || child.path === targetPath
        ? setChildrenAtPath(child, targetPath, children)
        : child,
    ),
  };
}

// ---------------------------------------------------------------------------
// Sort nodes (pure)
// ---------------------------------------------------------------------------

export function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// File count (pure)
// ---------------------------------------------------------------------------

export function countFilesInTree(node: FileNode): number {
  if (node.type === "file") return 1;
  let count = 0;
  if (node.children) {
    for (const child of node.children) {
      count += countFilesInTree(child);
    }
  }
  return count;
}

type FileExplorerNodeCollection = Collection<FileExplorerTreeNode, "path">;

function onlyDirectoryChild(
  nodes: FileExplorerNodeCollection,
  node: FileExplorerTreeNode,
): FileExplorerTreeNode | undefined {
  if (node.children.length !== 1) return undefined;
  const onlyChild = getItem(nodes, node.children[0]);
  return onlyChild?.type === "directory" ? onlyChild : undefined;
}

function hasExpandedDirectoryInCompactedChain(
  nodes: FileExplorerNodeCollection,
  node: FileExplorerTreeNode,
  expandedPaths: Set<string>,
): boolean {
  let current: FileExplorerTreeNode | undefined = node;
  while (current?.type === "directory") {
    if (expandedPaths.has(current.path)) return true;
    current = onlyDirectoryChild(nodes, current);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Flatten for virtualized rendering (pure)
// ---------------------------------------------------------------------------

export function flattenVisibleNodes(
  nodes: FileExplorerNodeCollection,
  childPaths: readonly string[],
  expandedPaths: Set<string>,
  loadingPaths: Set<string>,
  depth: number = 0,
  pathPrefix: string = "",
  result: FlattenedFileNode[] = [],
  compactedExpandedPaths: string[] = [],
): FlattenedFileNode[] {
  for (const childPath of childPaths) {
    const node = getItem(nodes, childPath);
    if (!node) continue;
    const nodeExpanded = expandedPaths.has(node.path);
    const nodeLoading = loadingPaths.has(node.path);
    const currentCompactedExpandedPaths = nodeExpanded
      ? [...compactedExpandedPaths, node.path]
      : compactedExpandedPaths;

    // Handle directory compaction
    if (node.type === "directory") {
      const onlyChild = onlyDirectoryChild(nodes, node);
      if (onlyChild) {
        const newPrefix = pathPrefix ? `${pathPrefix}/${node.name}` : node.name;
        if (nodeExpanded || hasExpandedDirectoryInCompactedChain(nodes, onlyChild, expandedPaths)) {
          flattenVisibleNodes(
            nodes,
            [onlyChild.path],
            expandedPaths,
            loadingPaths,
            depth,
            newPrefix,
            result,
            currentCompactedExpandedPaths,
          );
        } else {
          result.push({
            node: onlyChild,
            depth,
            displayPath: `${newPrefix}/${onlyChild.name}`,
            isExpanded: false,
            isLoading: loadingPaths.has(onlyChild.path),
          });
        }
        continue;
      }
    }

    result.push({
      node,
      depth,
      displayPath: pathPrefix ? `${pathPrefix}/${node.name}` : undefined,
      ...(pathPrefix && currentCompactedExpandedPaths.length > 0
        ? { compactedExpandedPaths: currentCompactedExpandedPaths }
        : {}),
      isExpanded: pathPrefix ? currentCompactedExpandedPaths.length > 0 : nodeExpanded,
      isLoading: nodeLoading,
    });

    if (
      node.type === "directory" &&
      (nodeExpanded || (pathPrefix && currentCompactedExpandedPaths.length > 0)) &&
      node.children.length > 0
    ) {
      flattenVisibleNodes(nodes, node.children, expandedPaths, loadingPaths, depth + 1, "", result);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Workspace ID extraction helper
// ---------------------------------------------------------------------------

export function extractWorkspaceId(path: string): string {
  const match = path.match(
    /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/,
  );
  if (match) return match[1];
  return path.split("/").pop() || "";
}
