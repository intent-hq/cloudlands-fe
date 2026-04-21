/**
 * Pure utility functions for file explorer tree operations.
 * No store, service, or side-effect dependencies.
 */
import type { FileNode, FileGitStatus } from "$shared/types";
import type { FlattenedFileNode } from "./file-explorer-types";
import { stripWorkspacePrefix } from "$lib/utils/file-utils";
import ignore from "ignore";

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

export const CACHE_TTL = 30000; // 30 seconds

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
// Git status application (pure)
// ---------------------------------------------------------------------------

export function applyGitStatusToTree(
  node: FileNode | null,
  gitStatus: Record<string, FileGitStatus>,
  workspacePath: string,
): FileNode | null {
  if (!node) return null;
  const updatedNode = { ...node };

  if (updatedNode.type === "file" && updatedNode.path) {
    const relativePath = stripWorkspacePrefix(updatedNode.path, workspacePath);
    const fileGitStatus = gitStatus[relativePath];
    updatedNode.gitStatus = fileGitStatus || undefined;
  }

  if (updatedNode.children) {
    updatedNode.children = updatedNode.children.map(
      (child) => applyGitStatusToTree(child, gitStatus, workspacePath) || child,
    );
  }
  return updatedNode;
}

// ---------------------------------------------------------------------------
// Sort & enrich nodes (pure)
// ---------------------------------------------------------------------------

export function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function enrichDirectoriesWithGitStatus(
  nodes: FileNode[],
  gitStatus: Record<string, FileGitStatus>,
  workspacePath: string,
): FileNode[] {
  return nodes.map((node) => {
    if (node.type !== "directory") return node;
    const nodeDirPath = stripWorkspacePrefix(node.path, workspacePath);
    for (const filePath of Object.keys(gitStatus)) {
      if (filePath.startsWith(`${nodeDirPath}/`)) {
        return { ...node, gitStatus: { status: "M ", additions: 0, deletions: 0 } };
      }
    }
    return node;
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

// ---------------------------------------------------------------------------
// Flatten for virtualized rendering (pure)
// ---------------------------------------------------------------------------

export function flattenVisibleNodes(
  nodes: FileNode[],
  expandedPaths: Set<string>,
  loadingPaths: Set<string>,
  depth: number = 0,
  pathPrefix: string = "",
  result: FlattenedFileNode[] = [],
): FlattenedFileNode[] {
  for (const node of nodes) {
    const nodeExpanded = expandedPaths.has(node.path);
    const nodeLoading = loadingPaths.has(node.path);

    // Handle directory compaction
    if (node.type === "directory" && node.children?.length === 1) {
      const onlyChild = node.children[0];
      if (onlyChild.type === "directory") {
        const newPrefix = pathPrefix ? `${pathPrefix}/${node.name}` : node.name;
        if (nodeExpanded || expandedPaths.has(onlyChild.path)) {
          flattenVisibleNodes([onlyChild], expandedPaths, loadingPaths, depth, newPrefix, result);
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
      isExpanded: nodeExpanded,
      isLoading: nodeLoading,
    });

    if (node.type === "directory" && nodeExpanded && node.children) {
      flattenVisibleNodes(node.children, expandedPaths, loadingPaths, depth + 1, "", result);
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
