/**
 * Gitignore Manager
 * Utility for parsing and checking gitignore patterns
 */

import * as path from 'path';
import * as fs from 'fs';
import ignore from 'ignore';

export class GitignoreManager {
  private ig: ReturnType<typeof ignore>;
  private rootPath: string;
  private patterns: string[] = [];
  private initialized = false;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
    this.ig = ignore();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.loadGitignore();
    this.initialized = true;
  }

  // Default patterns applied before user's .gitignore rules.
  // Added first so user negation patterns (e.g. `!dist`) can override them.
  // Keep in sync with DEFAULT_IGNORE_PATTERNS in file-explorer-store.svelte.ts
  // (the file explorer has the same core set; this list adds chokidar-specific
  // entries like .env that we don't want the file watcher to track).
  private static readonly DEFAULT_PATTERNS = [
    'node_modules',
    '.git',
    '.DS_Store',
    'Thumbs.db',
    'dist',
    'build',
    '.next',
    '.svelte-kit',
    'coverage',
    '.cache',
    '*.log',
    '.env',
    '.env.local',
    '.augment/*',
  ];

  private loadGitignore(): void {
    try {
      // Defaults first — user negations in .gitignore can override these
      this.ig.add(GitignoreManager.DEFAULT_PATTERNS);
      this.patterns.push(...GitignoreManager.DEFAULT_PATTERNS);

      const gitignorePath = path.join(this.rootPath, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf-8');
        const userPatterns = content.split('\n').filter((line) => line.trim() && !line.startsWith('#'));
        this.ig.add(userPatterns);
        this.patterns.push(...userPatterns);
      }
    } catch (error) {
      // Failed to load .gitignore — defaults are already added above.
      // If we errored before adding defaults (shouldn't happen), add them now.
      if (this.patterns.length === 0) {
        this.ig.add(GitignoreManager.DEFAULT_PATTERNS);
        this.patterns.push(...GitignoreManager.DEFAULT_PATTERNS);
      }
    }
  }

  isIgnored(filePath: string): boolean {
    // Handle both absolute and relative paths
    const isAbsolute = path.isAbsolute(filePath);
    const relativePath = isAbsolute ? path.relative(this.rootPath, filePath) : filePath;

    // If the path is outside the root (starts with ..), it's not part of the project
    // and should not be processed by gitignore rules
    if (relativePath.startsWith('..')) {
      // Files outside the project root are not ignored by default
      // Let the caller decide what to do with them
      return false;
    }

    // Check if the file is ignored
    return this.ig.ignores(relativePath);
  }

  // Alias for isIgnored
  shouldIgnore(filePath: string): boolean {
    return this.isIgnored(filePath);
  }

  getPatterns(): string[] {
    return [...this.patterns];
  }

  getChokidarPatterns(): string[] {
    // Convert gitignore patterns to chokidar ignore patterns.
    // Negation patterns (e.g. !important.log) need special handling:
    // the `!` prefix must stay at the front, wrapping only the path part.
    return this.patterns
      .filter((p) => p.trim().length > 0)
      .map((pattern) => {
        const isNegation = pattern.startsWith('!');
        const raw = isNegation ? pattern.slice(1) : pattern;

        let converted: string;
        if (!raw.includes('/') && !raw.includes('*')) {
          converted = `**/${raw}`;
        } else {
          converted = raw;
        }

        return isNegation ? `!${converted}` : converted;
      });
  }

  addPattern(pattern: string): void {
    this.patterns.push(pattern);
    this.ig.add(pattern);
  }

  reload(): void {
    this.ig = ignore();
    this.patterns = [];
    this.loadGitignore();
  }

  /**
   * Filter an array of file paths to exclude ignored files
   */
  filterFiles(files: string[]): string[] {
    return files.filter((file) => !this.isIgnored(file));
  }

  /**
   * Check if a directory should be traversed
   */
  shouldTraverseDirectory(dirPath: string): boolean {
    const relativePath = path.relative(this.rootPath, dirPath);

    // Always skip .git directory
    if (relativePath === '.git' || relativePath.startsWith('.git/')) {
      return false;
    }

    // Check if directory is ignored
    return !this.ig.ignores(`${relativePath}/`);
  }
}

// Factory function for creating GitignoreManager instances
export function createGitignoreManager(rootPath: string): GitignoreManager {
  return new GitignoreManager(rootPath);
}
