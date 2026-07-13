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
import { backendRequest } from '$lib/client/live/backend-transport';
import { logger } from '$lib/utils/client-logger';
import { fuzzyMatch } from '../fuzzy-matcher';

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
    logger.debug('[FileProvider] Searching for:', { query, context: { workspaceId: context.workspaceId } });

    const workspaceId = context.workspaceId;
    if (!workspaceId) {
      return [];
    }

    try {
      // Daemon-backed path search (search.fileNames, PROTOCOL §5.15); returns
      // workspace-relative paths.
      const result = await backendRequest<{ files?: string[] }>('search.fileNames', {
        workspaceId,
        pattern: query || '',
        limit: 10,
      });

      const paths = Array.isArray(result?.files) ? result.files : [];
      const files = paths.map((path) => {
        const name = path.split('/').pop() || path;
        const extension = name.split('.').pop() || '';
        return {
          id: `file-${path}`,
          label: name,
          type: 'file' as MentionType,
          uri: `file:${path}`,
          description: path,
          subtitle: path,
          score: 0.5,
          meta: {
            path,
            fullPath: path,
            relativePath: path,
            extension: extension,
            language: this.getLanguageFromExtension(extension),
          },
        };
      });

      return this.deduplicateAndDistinguish(files);
    } catch (error) {
      logger.error('[FileProvider] Search failed:', error);
      return [];
    }
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
          return this.fileToCandidate({ path, name, extension });
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

  private async fileToCandidate(file: FileSearchResult): Promise<MentionCandidate> {
    const icon = this.getFileIcon(file.extension);
    const displayPath = file.path;
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
      let group = filesByName.get(name);
      if (!group) {
        group = [];
        filesByName.set(name, group);
      }
      group.push(result);
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
