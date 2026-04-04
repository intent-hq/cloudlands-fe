/**
 * Git Version Service
 *
 * DEPRECATED: This service is replaced by JSONL-based versioning (version.service.ts)
 * which is cloud-sync friendly. Kept for backward compatibility with existing tests.
 *
 * Provides git-based version history for notes.
 * Each save creates a git commit, enabling full history via standard git commands.
 */

import { spawn as nodeSpawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Logger } from '../../../../shared/logger';

const logger = new Logger('GitVersionService');

/**
 * Git version info - legacy type
 * @deprecated Use VersionEntry from version.service.ts instead
 */
export interface GitVersionInfo {
  commitHash: string;
  message: string;
  author: string;
  date: string;
}

/**
 * Flag to disable git operations (for testing)
 */
let gitEnabled = true;

/**
 * Enable or disable git operations (for testing)
 */
export function setGitEnabled(enabled: boolean): void {
  gitEnabled = enabled;
}

// Centralized git environment to prevent credential prompts
import { gitEnv } from '../../../../shared/git/git-env';

/**
 * Execute a git command in the notes directory
 */
async function execGit(notesDir: string, args: string[]): Promise<string> {
  if (!gitEnabled) {
    // Return empty/success for disabled git
    return '';
  }

  return new Promise((resolve, reject) => {
    const proc = nodeSpawn('git', args, { cwd: notesDir, env: gitEnv, windowsHide: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`git ${args[0]} failed: ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Initialize git repo in notes directory if not already initialized
 */
export async function initGitRepo(notesDir: string): Promise<void> {
  const gitDir = path.join(notesDir, '.git');

  try {
    await fs.access(gitDir);
    // Git repo already exists
    return;
  } catch {
    // Initialize new repo
    await fs.mkdir(notesDir, { recursive: true });
    await execGit(notesDir, ['init']);
    await execGit(notesDir, ['config', 'user.email', 'workspaces@local']);
    await execGit(notesDir, ['config', 'user.name', 'Workspaces']);
    logger.info('Initialized git repo for notes', { notesDir });
  }
}

/**
 * Commit a note change to git
 */
export async function commitNote(
  notesDir: string,
  noteId: string,
  message: string,
  author?: { name: string; id: string },
): Promise<string | null> {
  try {
    const fileName = `${noteId}.md`;

    // Stage the file
    await execGit(notesDir, ['add', fileName]);

    // Check if there are changes to commit
    try {
      await execGit(notesDir, ['diff', '--cached', '--quiet']);
      // No changes to commit
      return null;
    } catch {
      // There are changes (diff --quiet returns non-zero when there are diffs)
    }

    // Commit with author info
    const authorStr = author
      ? `${author.name} <${author.id}@workspaces>`
      : 'Workspaces <workspaces@local>';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const commitHash = await execGit(notesDir, ['commit', '-m', message, '--author', authorStr]);

    // Get the commit hash
    const hash = await execGit(notesDir, ['rev-parse', 'HEAD']);
    logger.debug('Committed note change', { noteId, hash: hash.slice(0, 7) });
    return hash;
  } catch (error) {
    logger.error('Failed to commit note', error as Error, { noteId });
    return null;
  }
}

/**
 * Get version history for a note using git log
 */
export async function getNoteHistory(
  notesDir: string,
  noteId: string,
  limit = 50,
): Promise<GitVersionInfo[]> {
  try {
    const fileName = `${noteId}.md`;
    const format = '%H|%s|%an|%aI'; // hash|subject|author|date

    const output = await execGit(notesDir, [
      'log',
      `--format=${format}`,
      '-n',
      String(limit),
      '--',
      fileName,
    ]);

    if (!output) return [];

    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [commitHash, message, author, date] = line.split('|');
        return { commitHash, message, author, date };
      });
  } catch {
    return [];
  }
}

/**
 * Get note content at a specific commit
 */
export async function getNoteAtCommit(
  notesDir: string,
  noteId: string,
  commitHash: string,
): Promise<string | null> {
  try {
    const fileName = `${noteId}.md`;
    return await execGit(notesDir, ['show', `${commitHash}:${fileName}`]);
  } catch {
    return null;
  }
}
