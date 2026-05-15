/**
 * Enhanced File Provider with Range Support and Smart Scoring
 */

import type {
  Provider,
  MentionCandidate,
  SearchContext,
  MentionGroup,
  MentionType,
} from '../types';
import { invoke } from '$lib/electron-bridge';
import { logger } from '$lib/utils/client-logger';
import {
  fuzzyMatch,
  pathFuzzyMatch,
} from '../fuzzy-matcher';

// Cache for workspace repo paths to avoid repeated IPC calls
const workspaceRepoPathCache = new Map<string, string>();

/**
 * Clear the workspace root cache (for testing purposes)
 */
export function clearWorkspaceRootCache(): void {
  workspaceRepoPathCache.clear();
}

/**
 * Get the workspace repo/worktree path for a given workspace ID.
 * Returns the actual repository path (worktreePath or repositoryPath),
 * NOT the workspace storage/metadata folder.
 * Uses caching to avoid repeated IPC calls.
 */
async function getWorkspaceRoot(workspaceId: string): Promise<string | null> {
  if (workspaceRepoPathCache.has(workspaceId)) {
    return workspaceRepoPathCache.get(workspaceId) || null;
  }

  try {
    // Fetch the full workspace object to get the actual repo path
    const response = await invoke<{ success: boolean; data?: any }>('workspace:get-by-id', { workspaceId });
    if (response?.success && response.data) {
      const repoPath = response.data.worktreePath || response.data.repositoryPath;
      if (repoPath) {
        workspaceRepoPathCache.set(workspaceId, repoPath);
        return repoPath;
      }
    }
  } catch (error) {
    logger.debug('[FileProvider] Failed to get workspace repo path:', error);
  }

  // Fallback to workspace:get-root if workspace:get-by-id fails
  try {
    const result = await invoke<string>('workspace:get-root', { workspaceId });
    if (result) {
      workspaceRepoPathCache.set(workspaceId, result);
      return result;
    }
  } catch (error) {
    logger.debug('[FileProvider] Failed to get workspace root:', error);
  }

  return null;
}

/**
 * Convert an absolute path to a relative path based on workspace root
 * If the path is already relative or workspace root cannot be determined, returns the original path
 */
async function makePathRelative(absolutePath: string, workspaceId: string): Promise<string> {
  // If path is already relative, return as-is
  if (!absolutePath.startsWith('/')) {
    return absolutePath;
  }

  const workspaceRoot = await getWorkspaceRoot(workspaceId);
  if (!workspaceRoot) {
    return absolutePath;
  }

  // Remove trailing slash from workspace root for consistent comparison
  const normalizedRoot = workspaceRoot.endsWith('/') ? workspaceRoot.slice(0, -1) : workspaceRoot;

  // If path starts with workspace root, make it relative
  if (absolutePath.startsWith(normalizedRoot + '/')) {
    return absolutePath.slice(normalizedRoot.length + 1);
  }

  // If path equals workspace root, return empty string or '.'
  if (absolutePath === normalizedRoot) {
    return '.';
  }

  // Path is outside workspace root, return as-is
  return absolutePath;
}

interface FileSearchResult {
  path: string;
  name: string;
  extension: string;
  lastModified?: Date;
  size?: number;
  language?: string;
}

export class FileProvider implements Provider {
  id = 'file';
  triggers = ['@file', '@f'];
  default = true;
  supportsRanges = true;
  supportsLivePreview = true;

  private recentFiles: Set<string> = new Set();
  private fileIconMap: Record<string, string> = {
    ts: '📘',
    tsx: '⚛️',
    js: '📜',
    jsx: '⚛️',
    svelte: '🔥',
    vue: '💚',
    py: '🐍',
    rs: '🦀',
    go: '🐹',
    java: '☕',
    cpp: '⚙️',
    c: '⚙️',
    h: '📎',
    md: '📝',
    json: '📋',
    yaml: '📋',
    yml: '📋',
    toml: '📋',
    xml: '📋',
    html: '🌐',
    css: '🎨',
    scss: '🎨',
    sass: '🎨',
    less: '🎨',
    sql: '🗃️',
    sh: '🖥️',
    bash: '🖥️',
    zsh: '🖥️',
    fish: '🖥️',
    dockerfile: '🐳',
    docker: '🐳',
    gitignore: '🚫',
    env: '🔐',
    lock: '🔒',
    test: '🧪',
    spec: '🧪',
  };

  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    logger.debug('[FileProvider] Searching for:', { query, context: { workspaceId: context.workspaceId, repoPath: context.repoPath } });

    try {
      // Support both workspace and local repo search
      const workspaceId = context.workspaceId;
      const repoPath = context.repoPath;

      // If we have a workspace, use authorized IPC channels
      if (workspaceId) {
        // Get workspace root using authorized IPC
        const workspaceRoot = await getWorkspaceRoot(workspaceId);
        if (workspaceRoot) {
          // Use authorized file:list IPC with recursive option
          logger.debug('[FileProvider] Searching workspace at:', workspaceRoot);
          const result: any = await invoke('file:list', {
            path: workspaceRoot,
            recursive: true,
          });

          if (result && result.success && result.data && result.data.length > 0) {
            const files = result.data
              .filter((entry: any) => entry.isFile)
              .filter((file: any) => {
                if (!query) return true;
                return pathFuzzyMatch(query, file.path || file.name) !== null;
              })
              .slice(0, 10)
              .map(async (file: any) => {
                const extension = file.name.split('.').pop() || '';
                const displayPath = await makePathRelative(file.path, workspaceId);
                return {
                  id: `file-${file.path}`,
                  label: file.name,
                  type: 'file' as MentionType,
                  uri: `file:${file.path}`,
                  description: displayPath,
                  subtitle: displayPath,
                  score: 0.5,
                  meta: {
                    path: displayPath,
                    fullPath: file.path,
                    relativePath: displayPath,
                    extension: extension,
                    language: this.getLanguageFromExtension(extension),
                  },
                };
              });

            if (files.length > 0) {
              const resolvedFiles = await Promise.all(files);
              return this.deduplicateAndDistinguish(resolvedFiles);
            }
          }
        }
      } else if (repoPath) {
        // Search local repo using file:list IPC with recursive option
        logger.debug('[FileProvider] Searching local repo at:', repoPath);
        const result: any = await invoke('file:list', {
          path: repoPath,
          recursive: true,
        });

        if (result && result.success && result.data && result.data.length > 0) {
          // Normalize repoPath by removing trailing slash for consistent comparison
          const normalizedRepoPath = repoPath.endsWith('/') ? repoPath.slice(0, -1) : repoPath;

          const files = result.data
            .filter((entry: any) => entry.isFile)
            .filter((file: any) => {
              if (!query) return true;
              return pathFuzzyMatch(query, file.path || file.name) !== null;
            })
            .slice(0, 10)
            .map((file: any) => {
              const extension = file.name.split('.').pop() || '';
              // Safely strip repo path prefix using startsWith check
              let relativePath = file.path;
              if (file.path.startsWith(normalizedRepoPath + '/')) {
                relativePath = file.path.slice(normalizedRepoPath.length + 1);
              } else if (file.path === normalizedRepoPath) {
                relativePath = '.';
              }
              return {
                id: `file-${file.path}`,
                label: file.name,
                type: 'file' as MentionType,
                uri: `file:${file.path}`,
                description: relativePath,
                subtitle: relativePath,
                score: 0.5,
                meta: {
                  path: relativePath,
                  fullPath: file.path,
                  extension: extension,
                  language: this.getLanguageFromExtension(extension),
                },
              };
            });

          if (files.length > 0) {
            return this.deduplicateAndDistinguish(files);
          }
        }
      }
    } catch (error) {
      logger.error('[FileProvider] Search failed:', error);
    }

    // Fallback to common files if search fails
    const fallbackFiles = [
      { path: 'README.md', name: 'README.md', extension: 'md' },
      { path: 'package.json', name: 'package.json', extension: 'json' },
      { path: 'tsconfig.json', name: 'tsconfig.json', extension: 'json' },
      { path: '.gitignore', name: '.gitignore', extension: '' },
      { path: 'src/index.ts', name: 'index.ts', extension: 'ts' },
    ];

    const filtered = fallbackFiles.filter((file) => {
      if (!query) return true;
      return pathFuzzyMatch(query, file.path) !== null;
    });

    return Promise.all(filtered.map((file) => this.fileToCandidate(file)));
  }

  private async searchRecent(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    if (!context.recentFiles || context.recentFiles.length === 0) {
      return [];
    }

    const recentCandidates = await Promise.all(
      context.recentFiles
        .filter((path) => {
          if (!query) return true;
          return fuzzyMatch(query, path) !== null;
        })
        .slice(0, 3)
        .map((path) => {
          const name = path.split('/').pop() || path;
          const extension = name.split('.').pop() || '';
          return this.fileToCandidate({ path, name, extension }, context.workspaceId);
        }),
    );

    // Mark as recent
    recentCandidates.forEach((c) => {
      this.recentFiles.add(c.uri);
    });

    return recentCandidates;
  }

  private async searchContextual(
    query: string,
    context: SearchContext,
  ): Promise<MentionCandidate[]> {
    // Search for files related to current context
    if (!context.currentFile) {
      return [];
    }

    // Find files in same directory

    // This would normally search for files in the same directory
    // For now, returning empty
    return [];
  }

  private async fileToCandidate(file: FileSearchResult, workspaceId?: string): Promise<MentionCandidate> {
    const icon = this.getFileIcon(file.extension);
    // Convert absolute path to relative if workspace ID is provided
    const displayPath = workspaceId ? await makePathRelative(file.path, workspaceId) : file.path;
    const shortPath = this.formatPath(displayPath);

    return {
      id: `file-${file.path}`,
      type: 'file' as MentionType,
      label: file.name,
      subtitle: shortPath,
      description: displayPath,
      icon,
      uri: `devspace://file/${encodeURIComponent(file.path)}`,
      meta: {
        path: displayPath,
        fullPath: file.path,
        lastModified: file.lastModified,
        size: file.size,
        language: file.language || this.getLanguageFromExtension(file.extension),
      },
    };
  }

  private combineResults(...resultSets: MentionCandidate[][]): MentionCandidate[] {
    const seen = new Set<string>();
    const combined: MentionCandidate[] = [];

    for (const results of resultSets) {
      for (const result of results) {
        if (!seen.has(result.uri)) {
          seen.add(result.uri);
          combined.push(result);
        }
      }
    }

    return this.deduplicateAndDistinguish(combined);
  }

  /**
   * Detect duplicate filenames and ensure each has a distinguishing path
   * For files with the same name, show enough path to distinguish them
   * For unique files, keep the path minimal
   */
  private deduplicateAndDistinguish(results: MentionCandidate[]): MentionCandidate[] {
    // Group results by filename (label)
    const filesByName = new Map<string, MentionCandidate[]>();

    for (const result of results) {
      const name = result.label;
      if (!filesByName.has(name)) {
        filesByName.set(name, []);
      }
      filesByName.get(name)!.push(result);
    }

    // Process each group
    const processed: MentionCandidate[] = [];

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [filename, candidates] of filesByName.entries()) {
      if (candidates.length === 1) {
        // Single file with this name - keep as is
        processed.push(candidates[0]);
      } else {
        // Multiple files with same name - ensure each has distinguishing path
        const distinguished = this.distinguishDuplicates(candidates);
        processed.push(...distinguished);
      }
    }

    return processed;
  }

  /**
   * For duplicate filenames, ensure each has a distinguishing path
   * Shows the minimum path needed to distinguish between duplicates
   */
  private distinguishDuplicates(candidates: MentionCandidate[]): MentionCandidate[] {
    // Get all paths from description or meta.path
    const paths = candidates.map(c => c.description || c.meta?.path || '');

    // Find the minimum number of path segments needed to distinguish each file
    const distinguished = candidates.map((candidate, index) => {
      const currentPath = paths[index];
      const otherPaths = paths.filter((_, i) => i !== index);

      // Find minimum segments needed to distinguish from others
      const segments = currentPath.split('/');
      let distinguishingPath = '';

      for (let i = segments.length; i > 0; i--) {
        const testPath = segments.slice(-i).join('/');

        // Check if this path segment is unique among other files
        const isUnique = !otherPaths.some(other => {
          const otherSegments = other.split('/');
          const otherTest = otherSegments.slice(-i).join('/');
          return otherTest === testPath;
        });

        if (isUnique || i === 1) {
          distinguishingPath = testPath;
          break;
        }
      }

      // Return candidate with updated subtitle showing distinguishing path
      return {
        ...candidate,
        subtitle: distinguishingPath,
      };
    });

    return distinguished;
  }

  private groupResults(results: MentionCandidate[]): MentionCandidate[] {
    const groups: Record<string, MentionCandidate[]> = {
      recent: [],
      relevant: [],
      other: [],
    };

    for (const result of results) {
      if (this.recentFiles.has(result.uri)) {
        groups.recent.push(result);
      } else if ((result.score ?? 0) > 0.7) {
        groups.relevant.push(result);
      } else {
        groups.other.push(result);
      }
    }

    const grouped: MentionCandidate[] = [];

    if (groups.recent.length > 0) {
      grouped.push(...groups.recent.slice(0, 3).map((r) => ({ ...r, group: 'Recent Files' })));
    }

    if (groups.relevant.length > 0) {
      grouped.push(...groups.relevant.slice(0, 5).map((r) => ({ ...r, group: 'Most Relevant' })));
    }

    if (groups.other.length > 0) {
      grouped.push(...groups.other.slice(0, 10).map((r) => ({ ...r, group: 'Other Files' })));
    }

    return grouped;
  }

  scoreRelevance(item: MentionCandidate, context: SearchContext): number {
    let score = 0.5; // Base score

    // Boost recent files
    if (this.recentFiles.has(item.uri)) {
      score += 0.2;
    }

    // Boost files in same directory
    if (context.currentFile && item.meta?.path) {
      const currentDir = context.currentFile.substring(0, context.currentFile.lastIndexOf('/'));
      const itemDir = item.meta.path.substring(0, item.meta.path.lastIndexOf('/'));

      if (currentDir === itemDir) {
        score += 0.15;
      }
    }

    // Boost files with related imports
    if (context.imports?.includes(item.meta?.path || '')) {
      score += 0.25;
    }

    // Boost test files when in test file
    if (context.currentFile?.includes('.test.') && item.meta?.path?.includes('.test.')) {
      score += 0.1;
    }

    return Math.min(score, 1);
  }

  getGroups(): MentionGroup[] {
    return [
      {
        id: 'files-recent',
        label: 'Recent Files',
        icon: '🕐',
      },
      {
        id: 'files-all',
        label: 'All Files',
        icon: '📁',
      },
      {
        id: 'files-tests',
        label: 'Test Files',
        icon: '🧪',
      },
    ];
  }

  private getFileIcon(extension: string): string {
    return this.fileIconMap[extension.toLowerCase()] || '📄';
  }

  private formatPath(path: string): string {
    if (path.length > 40) {
      const parts = path.split('/');
      if (parts.length > 2) {
        return `.../${parts.slice(-2).join('/')}`;
      }
    }
    return path;
  }

  private getLanguageFromExtension(extension: string): string {
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescriptreact',
      js: 'javascript',
      jsx: 'javascriptreact',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      svelte: 'svelte',
      vue: 'vue',
      md: 'markdown',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      html: 'html',
      css: 'css',
      scss: 'scss',
      sql: 'sql',
      sh: 'shellscript',
    };

    return languageMap[extension.toLowerCase()] || 'plaintext';
  }
}
