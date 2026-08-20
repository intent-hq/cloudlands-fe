/**
 * Pure utility functions for file explorer tree operations.
 * No store, service, or side-effect dependencies.
 */
import type { FileNode } from '$shared/types';
import type { FlattenedFileNode, FileExplorerTreeNode } from './file-explorer-types';
import { stripWorkspacePrefix } from '$lib/utils/file-utils';
import ignore from 'ignore';
import { getItem, type Collection } from '@augmentcode/themis/utils/collections/collection-utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALWAYS_HIDE = new Set(['.git']);

const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.DS_Store',
  'Thumbs.db',
  'dist',
  'build',
  '.next',
  '.svelte-kit',
  'coverage',
  '.cache',
  '*.log',
];

// ---------------------------------------------------------------------------
// Gitignore helpers
// ---------------------------------------------------------------------------

let cachedPatternsRef: string[] | null = null;
let cachedIg: ReturnType<typeof ignore> | null = null;

function getIgnoreInstance(patterns: string[]): ReturnType<typeof ignore> {
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
  const lastSlash = filePath.lastIndexOf('/');
  const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  return ALWAYS_HIDE.has(fileName);
}

export function checkGitignored(
  filePath: string,
  workspacePath: string,
  gitignorePatterns: string[],
): boolean {
  const stripped = stripWorkspacePrefix(filePath, workspacePath);
  const lastSlash = filePath.lastIndexOf('/');
  const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  const relativePath = stripped !== filePath ? stripped : fileName;
  const ig = getIgnoreInstance(gitignorePatterns);
  return ig.ignores(relativePath);
}

// ---------------------------------------------------------------------------
// Sort nodes (pure)
// ---------------------------------------------------------------------------

export function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Recursive variant of {@link sortNodes}: applies folder-first / alphabetical
 * ordering at every nesting depth of the supplied subtree. Used at the slice
 * normalization boundary so the stored children path-order is the single
 * sorted source of truth.
 */
export function sortNodesRecursive(nodes: FileNode[]): FileNode[] {
  return sortNodes(nodes).map((node) =>
    node.children ? { ...node, children: sortNodesRecursive(node.children) } : node,
  );
}

type FileExplorerNodeCollection = Collection<FileExplorerTreeNode, 'path'>;

function onlyDirectoryChild(
  nodes: FileExplorerNodeCollection,
  node: FileExplorerTreeNode,
): FileExplorerTreeNode | undefined {
  if (node.children.length !== 1) return undefined;
  const onlyChild = getItem(nodes, node.children[0]);
  return onlyChild?.type === 'directory' ? onlyChild : undefined;
}

function hasExpandedDirectoryInCompactedChain(
  nodes: FileExplorerNodeCollection,
  node: FileExplorerTreeNode,
  expandedPaths: Set<string>,
): boolean {
  let current: FileExplorerTreeNode | undefined = node;
  while (current?.type === 'directory') {
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
  pathPrefix: string = '',
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
    if (node.type === 'directory') {
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
      node.type === 'directory' &&
      (nodeExpanded || (pathPrefix && currentCompactedExpandedPaths.length > 0)) &&
      node.children.length > 0
    ) {
      flattenVisibleNodes(nodes, node.children, expandedPaths, loadingPaths, depth + 1, '', result);
    }
  }
  return result;
}
