/**
 * Reference Resolver Service
 *
 * Resolves semantic IDs to actual code content from the codebase.
 * Handles both symbol references and line-based references.
 *
 * NOTE: This service runs in the main process and uses direct file system
 * access instead of IPC.
 */

import { promises as fs } from 'fs';
import {
  join,
  extname,
} from 'path';
import {
  parseSemanticId,
  type ParsedSemanticId,
} from '$shared/types/notes-primitives';
import { EnhancedLogger } from '$shared/enhanced-logger';
import { workspaceService } from '../../workspace/main/workspace.service';
import { createWorkspaceId } from '$shared/types';

const logger = new EnhancedLogger('ReferenceResolver');

/**
 * Maximum file size for reference resolution (2MB)
 * Files larger than this will be truncated to prevent memory issues
 */
const MAX_REFERENCE_FILE_SIZE = 2 * 1024 * 1024;

// Map file extensions to language IDs
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.svelte': 'svelte',
  '.vue': 'vue',
};

export interface ResolvedReference {
  code: string;
  filePath: string;
  languageId?: string;
  range?: {
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
  };
}

export class ReferenceResolverService {
  private static instance: ReferenceResolverService;
  private cache = new Map<string, ResolvedReference>();

  private constructor() {}

  static getInstance(): ReferenceResolverService {
    if (!ReferenceResolverService.instance) {
      ReferenceResolverService.instance = new ReferenceResolverService();
    }
    return ReferenceResolverService.instance;
  }

  /**
   * Get the workspace path from workspaceId
   */
  private async getWorkspacePath(workspaceId: string): Promise<string> {
    const workspace = await workspaceService.getWorkspace(createWorkspaceId(workspaceId));
    if (!workspace.ok) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    const path =
      workspace.data.worktreePath || workspace.data.repositoryPath || workspace.data.path;
    if (!path) {
      throw new Error(`Workspace has no valid path: ${workspaceId}`);
    }
    return path;
  }

  /**
   * Get language ID from file extension
   */
  private getLanguageId(filePath: string): string | undefined {
    const ext = extname(filePath).toLowerCase();
    return EXTENSION_TO_LANGUAGE[ext];
  }

  /**
   * Resolve a semantic ID to actual code content
   */
  async resolve(
    workspaceId: string,
    semanticId: string,
    useCache = true,
  ): Promise<{ ok: true; data: ResolvedReference } | { ok: false; error: string }> {
    try {
      // Check cache
      const cacheKey = `${workspaceId}:${semanticId}`;
      if (useCache && this.cache.has(cacheKey)) {
        return { ok: true, data: this.cache.get(cacheKey)! };
      }

      // Parse semantic ID
      const parsed = parseSemanticId(semanticId);
      if (!parsed) {
        return { ok: false, error: `Invalid semantic ID: ${semanticId}` };
      }

      // Resolve based on type
      // parseSemanticId returns different structures:
      // - File format: { filePath, type: 'file' }
      // - Symbol format: { filePath, type: 'symbol', symbol }
      // - Line format: { filePath, type: 'line', startLine, endLine? }
      // - Legacy lines: format: { filePath, refSpec: { type: 'lines', value } }
      let resolved: ResolvedReference;
      const resolveType = parsed.type || parsed.refSpec?.type;
      if (resolveType === 'symbol') {
        resolved = await this.resolveSymbol(workspaceId, parsed);
      } else if (resolveType === 'file') {
        resolved = await this.resolveFile(workspaceId, parsed);
      } else {
        resolved = await this.resolveLines(workspaceId, parsed);
      }

      // Cache result
      this.cache.set(cacheKey, resolved);

      return { ok: true, data: resolved };
    } catch (error) {
      logger.error('Failed to resolve reference', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to resolve reference',
      };
    }
  }

  /**
   * Read a file from the workspace with size limits
   */
  private async readWorkspaceFile(workspaceId: string, filePath: string): Promise<string> {
    const workspacePath = await this.getWorkspacePath(workspaceId);
    const fullPath = join(workspacePath, filePath);

    // Check file size before reading to prevent memory issues
    const stats = await fs.stat(fullPath);
    if (stats.size > MAX_REFERENCE_FILE_SIZE) {
      logger.warn('File too large for reference resolution, truncating', {
        filePath,
        size: stats.size,
        maxSize: MAX_REFERENCE_FILE_SIZE,
      });

      // Read only the first MAX_REFERENCE_FILE_SIZE bytes
      const fileHandle = await fs.open(fullPath, 'r');
      try {
        const buffer = Buffer.alloc(MAX_REFERENCE_FILE_SIZE);
        await fileHandle.read(buffer, 0, MAX_REFERENCE_FILE_SIZE, 0);
        const content = buffer.toString('utf-8');
        // Append truncation notice
        return `${content  }\n\n// ... [File truncated due to size limits] ...`;
      } finally {
        await fileHandle.close();
      }
    }

    return await fs.readFile(fullPath, 'utf-8');
  }

  /**
   * Resolve a file-only reference (returns entire file contents)
   */
  private async resolveFile(
    workspaceId: string,
    parsed: ParsedSemanticId,
  ): Promise<ResolvedReference> {
    const content = await this.readWorkspaceFile(workspaceId, parsed.filePath);
    const lines = content.split('\n');

    return {
      code: content,
      filePath: parsed.filePath,
      languageId: this.getLanguageId(parsed.filePath),
      range: {
        startLine: 1,
        endLine: lines.length,
      },
    };
  }

  /**
   * Resolve a symbol reference
   * Since we don't have a symbol search in the main process, we fall back to approximate location
   */
  private async resolveSymbol(
    workspaceId: string,
    parsed: ParsedSemanticId,
  ): Promise<ResolvedReference> {
    // Get symbol value from new format (parsed.symbol) or legacy format (parsed.refSpec.value)
    const symbolValue = parsed.symbol || parsed.refSpec?.value;
    if (!symbolValue) {
      throw new Error('No symbol value found in parsed reference');
    }

    // Fall back to file + approximate location
    // (Symbol search would require LSP or AST parsing which is complex in main process)
    return this.resolveApproximate(workspaceId, parsed);
  }

  /**
   * Resolve a line-based reference
   */
  private async resolveLines(
    workspaceId: string,
    parsed: ParsedSemanticId,
  ): Promise<ResolvedReference> {
    let startLine: number;
    let endLine: number;

    // Handle new format (parsed.startLine, parsed.endLine) vs legacy format (parsed.refSpec.value)
    if (typeof parsed.startLine === 'number') {
      // New format: already parsed
      startLine = parsed.startLine;
      endLine = parsed.endLine ?? startLine;
    } else if (parsed.refSpec?.value) {
      // Legacy format: parse from string like "L10-20" or "L15"
      const lineMatch = parsed.refSpec.value.match(/L(\d+)(?:-(\d+))?/);
      if (!lineMatch) {
        throw new Error(`Invalid line reference: ${parsed.refSpec.value}`);
      }
      startLine = parseInt(lineMatch[1], 10);
      endLine = lineMatch[2] ? parseInt(lineMatch[2], 10) : startLine;
    } else {
      throw new Error('No line range found in parsed reference');
    }

    // Read file content directly from the file system
    const content = await this.readWorkspaceFile(workspaceId, parsed.filePath);
    const lines = content.split('\n');

    // Extract the requested line range (1-based to 0-based conversion)
    const extractedLines = lines.slice(startLine - 1, endLine);
    const code = extractedLines.join('\n');

    return {
      code,
      filePath: parsed.filePath,
      languageId: this.getLanguageId(parsed.filePath),
      range: {
        startLine,
        endLine,
      },
    };
  }

  /**
   * Resolve approximate location when symbol can't be found
   */
  private async resolveApproximate(
    workspaceId: string,
    parsed: ParsedSemanticId,
  ): Promise<ResolvedReference> {
    // Get symbol value from new format or legacy format
    const symbolValue = parsed.symbol || parsed.refSpec?.value || '';
    // Try to read the whole file and search for the symbol name
    const symbolName = symbolValue.split('.').pop() || symbolValue;

    // Read file content directly from the file system
    const content = await this.readWorkspaceFile(workspaceId, parsed.filePath);
    const lines = content.split('\n');

    let startLine = 1;
    let endLine = lines.length;

    // Simple heuristic: find lines containing the symbol name
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(symbolName)) {
        startLine = i + 1;
        // Try to find the end of the block (simple heuristic)
        endLine = Math.min(startLine + 20, lines.length);
        break;
      }
    }

    const code = lines.slice(startLine - 1, endLine).join('\n');

    return {
      code,
      filePath: parsed.filePath,
      languageId: this.getLanguageId(parsed.filePath),
      range: {
        startLine,
        endLine,
      },
    };
  }

  /**
   * Clear the cache
   */
  clearCache(workspaceId?: string): void {
    if (workspaceId) {
      // Clear only entries for specific workspace
      const prefix = `${workspaceId}:`;
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) {
          this.cache.delete(key);
        }
      }
    } else {
      // Clear all
      this.cache.clear();
    }
  }

  /**
   * Batch resolve multiple semantic IDs
   */
  async resolveBatch(
    workspaceId: string,
    semanticIds: string[],
  ): Promise<Map<string, ResolvedReference | null>> {
    const results = new Map<string, ResolvedReference | null>();

    await Promise.all(
      semanticIds.map(async (id) => {
        const result = await this.resolve(workspaceId, id);
        results.set(id, result.ok ? result.data : null);
      }),
    );

    return results;
  }
}

// Export singleton instance
export const referenceResolver = ReferenceResolverService.getInstance();
