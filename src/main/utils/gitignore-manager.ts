import { createRequire } from 'module';
import { readFile } from 'fs/promises';
import {
  join,
  relative,
} from 'path';
import ignore from 'ignore';
import { existsSync } from 'fs';
import { Logger } from '$shared/logger';

const require = createRequire(import.meta.url);
const logger = new Logger('GitignoreManager');

export class GitignoreManager {
  private ig: ReturnType<typeof ignore>;
  private repositoryPath: string;
  private worktreePath: string;
  private gitignorePath: string;
  private lastModified: number = 0;
  private checkInterval: number = 5000; // Check for updates every 5 seconds
  private updateTimer?: NodeJS.Timeout;

  constructor(repositoryPath: string, worktreePath?: string) {
    this.repositoryPath = repositoryPath;
    this.worktreePath = worktreePath || repositoryPath;
    this.gitignorePath = join(repositoryPath, '.gitignore');
    this.ig = ignore();

    // Always include some default patterns
    this.ig.add([
      '.git',
      'node_modules',
      '.DS_Store',
      'Thumbs.db',
      '*.log',
      '.env',
      '.env.*',
      '!.env.example',
    ]);
  }

  /**
   * Initialize the gitignore manager and load patterns
   */
  async initialize(): Promise<void> {
    await this.loadGitignorePatterns();

    // Start watching for gitignore changes
    this.startWatching();
  }

  /**
   * Load patterns from .gitignore file
   */
  private async loadGitignorePatterns(): Promise<void> {
    try {
      if (!existsSync(this.gitignorePath)) {
        logger.debug(`No .gitignore file found at ${this.gitignorePath}`);
        return;
      }

      const stats = await require('fs/promises').stat(this.gitignorePath);
      const modified = stats.mtimeMs;

      // Only reload if file has been modified
      if (modified <= this.lastModified) {
        return;
      }

      const content = await readFile(this.gitignorePath, 'utf-8');
      const patterns = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#')); // Remove empty lines and comments

      // Create a new ignore instance to replace the old one
      const newIg = ignore();

      // Add default patterns first
      newIg.add([
        '.git',
        'node_modules',
        '.DS_Store',
        'Thumbs.db',
        '*.log',
        '.env',
        '.env.*',
        '!.env.example',
      ]);

      // Add patterns from gitignore file
      newIg.add(patterns);

      this.ig = newIg;
      this.lastModified = modified;

      logger.debug(`Loaded ${patterns.length} patterns from .gitignore`);
    } catch (error) {
      logger.error('Error loading .gitignore:', error as Error);
    }
  }

  /**
   * Start watching for gitignore changes
   */
  private startWatching(): void {
    // Periodically check for gitignore updates
    this.updateTimer = setInterval(async () => {
      await this.loadGitignorePatterns();
    }, this.checkInterval);
  }

  /**
   * Stop watching for gitignore changes
   */
  stopWatching(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }
  }

  /**
   * Check if a file path should be ignored
   * @param filePath - Absolute or relative path to check (relative to worktree)
   * @returns true if the file should be ignored
   */
  shouldIgnore(filePath: string): boolean {
    // Convert absolute path to relative if needed
    let relativePath = filePath;

    // If it's an absolute path, make it relative to the worktree
    if (filePath.startsWith(this.worktreePath)) {
      relativePath = relative(this.worktreePath, filePath);
    }

    // For worktrees, we need to check the path relative to the repository root
    // since that's where the .gitignore file lives
    if (this.worktreePath !== this.repositoryPath) {
      // The file path is relative to the worktree, but gitignore patterns
      // are relative to the repository root. Since worktrees have the same
      // structure as the main repo, we can use the path as-is.
      // The gitignore patterns will work correctly.
    }

    // Normalize path separators for cross-platform compatibility
    relativePath = relativePath.replace(/\\/g, '/');

    // Check if the path should be ignored
    return this.ig.ignores(relativePath);
  }

  /**
   * Get common ignore patterns as globs
   * This converts gitignore patterns to glob patterns
   */
  getGlobPatterns(): string[] {
    // Common glob ignore patterns that can be used directly
    return [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.svelte-kit/**',
      '**/coverage/**',
      '**/.DS_Store',
      '**/Thumbs.db',
      '**/*.log',
      '**/npm-debug.log*',
      '**/yarn-debug.log*',
      '**/yarn-error.log*',
      '**/pnpm-debug.log*',
      '**/package-lock.json',
      '**/yarn.lock',
      '**/pnpm-lock.yaml',
      '**/.env',
      '**/.env.*',
      '!**/.env.example',
      '**/*.tmp',
      '**/*.temp',
      '**/.cache/**',
      '**/*.tsbuildinfo',
      '**/.workspace-notes/**',
      '**/.workspace-notes.backup/**',
      '**/out/**',
      '**/dist-electron/**',
      '**/.vscode/*',
      '!**/.vscode/extensions.json',
      '!**/.vscode/settings.json',
      '**/.idea/**',
      '**/.pnpm-store/**',
    ];
  }

  /**
   * Filter a list of file paths to exclude ignored files
   */
  filterPaths(paths: string[]): string[] {
    return paths.filter((path) => !this.shouldIgnore(path));
  }
}
