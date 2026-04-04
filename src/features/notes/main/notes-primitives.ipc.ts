/**
 * Notes Primitives IPC
 *
 * IPC handlers for note primitives operations including:
 * - Reference resolution
 * - CLI command execution
 * - Patch validation and application
 * - Agent action launching
 */

import { Logger } from '$shared/logger';
import { WorkspaceConfig } from '$shared/main/config';
import { createWorkspaceId } from '$shared/types';
import { exec } from 'child_process';
import { ipcMain } from 'electron';
import { killChildProcessTree } from '../../../shared/main/process-tree-kill';
import { existsSync } from 'fs';
import { copyFile, mkdir, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { referenceResolver } from './reference-resolver.service';
import { workspaceService } from '../../workspace/main/workspace.service';
import { execAsync } from '../../../shared/git/git-env';

/**
 * Get the path to the patch backups directory for a workspace.
 * Backups are stored in ~/intent/{workspaceId}/.workspace/patch-backups/
 */
function getPatchBackupsDir(workspaceId: string): string {
  return join(WorkspaceConfig.paths.metadata(workspaceId), 'patch-backups');
}

/**
 * Generate a backup filename that encodes the original file path.
 * Format: {encoded-path}.backup.{timestamp}
 * The path is encoded by replacing / with __ to make it a valid filename.
 */
function getBackupFileName(relativePath: string, timestamp: number): string {
  const encodedPath = relativePath.replace(/\//g, '__');
  return `${encodedPath}.backup.${timestamp}`;
}

/**
 * Decode a backup filename back to the original relative path.
 */
function decodeBackupFileName(
  backupFileName: string,
): { relativePath: string; timestamp: number } | null {
  const match = backupFileName.match(/^(.+)\.backup\.(\d+)$/);
  if (!match) return null;
  const encodedPath = match[1];
  const timestamp = parseInt(match[2], 10);
  const relativePath = encodedPath.replace(/__/g, '/');
  return { relativePath, timestamp };
}

const logger = new Logger('NotesPrimitivesIPC');

/**
 * Ensure a diff has proper unified diff format.
 * Handles three cases:
 * 1. Full unified diff (has ---, +++, @@) - validate and fix line counts if needed
 * 2. Partial unified diff (has @@ hunk headers but no file headers) - add file headers
 * 3. Raw +/- lines only - construct full unified diff
 */
function ensureUnifiedDiffFormat(diff: string, filePath: string): string {
  // Normalize line endings
  const normalizedDiff = diff.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const hasFileHeaders = normalizedDiff.includes('--- ') && normalizedDiff.includes('+++ ');
  const hasHunkHeader = normalizedDiff.includes('@@ ');

  // Case 1: Full unified diff - validate hunk headers and fix line counts
  if (hasFileHeaders && hasHunkHeader) {
    // Parse the diff to validate and fix any incorrect line counts
    const lines = normalizedDiff.split('\n');
    const resultLines: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Check for hunk header
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (hunkMatch) {
        // Count actual lines in this hunk
        let oldCount = 0;
        let newCount = 0;
        const hunkLines: string[] = [];
        let j = i + 1;

        while (j < lines.length) {
          const hunkLine = lines[j];
          // Stop at next hunk header or end
          if (hunkLine.match(/^@@ /)) break;
          // Stop at file headers
          if (hunkLine.startsWith('--- ') || hunkLine.startsWith('+++ ')) break;
          // Skip empty lines at very end
          if (hunkLine === '' && j === lines.length - 1) {
            j++;
            break;
          }

          if (hunkLine.startsWith('+') && !hunkLine.startsWith('+++')) {
            newCount++;
            hunkLines.push(hunkLine);
          } else if (hunkLine.startsWith('-') && !hunkLine.startsWith('---')) {
            oldCount++;
            hunkLines.push(hunkLine);
          } else if (hunkLine.startsWith(' ') || hunkLine === '') {
            // Context line
            oldCount++;
            newCount++;
            hunkLines.push(hunkLine.startsWith(' ') ? hunkLine : ` ${hunkLine}`);
          } else {
            // Unknown line format - might be corrupted, treat as context
            oldCount++;
            newCount++;
            hunkLines.push(` ${hunkLine}`);
          }
          j++;
        }

        // Reconstruct hunk header with correct counts
        const startOld = parseInt(hunkMatch[1], 10);
        const startNew = parseInt(hunkMatch[3], 10);
        const extra = hunkMatch[5] || '';
        resultLines.push(`@@ -${startOld},${oldCount} +${startNew},${newCount} @@${extra}`);
        resultLines.push(...hunkLines);
        i = j;
      } else {
        // File header or other line - keep as-is
        resultLines.push(line);
        i++;
      }
    }

    // Remove trailing empty lines and ensure single trailing newline
    while (resultLines.length > 0 && resultLines[resultLines.length - 1] === '') {
      resultLines.pop();
    }
    return `${resultLines.join('\n')}\n`;
  }

  // Case 2: Has hunk header but no file headers - prepend file headers and reprocess
  if (hasHunkHeader && !hasFileHeaders) {
    const withHeaders = `--- a/${filePath}\n+++ b/${filePath}\n${normalizedDiff}`;
    return ensureUnifiedDiffFormat(withHeaders, filePath);
  }

  // Case 3: Raw diff lines only - construct full unified diff
  // Parse the lines preserving context lines (space prefix), additions (+), and deletions (-)
  const lines = normalizedDiff.split('\n');
  const diffLines: string[] = [];
  let oldLineCount = 0;
  let newLineCount = 0;

  for (const line of lines) {
    // Skip completely empty lines at the start/end
    if (line === '' && diffLines.length === 0) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      // Addition line
      diffLines.push(line);
      newLineCount++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // Deletion line
      diffLines.push(line);
      oldLineCount++;
    } else if (line.startsWith(' ') || line === '') {
      // Context line (starts with space) or empty context line
      diffLines.push(line.startsWith(' ') ? line : ' ');
      oldLineCount++;
      newLineCount++;
    }
  }

  // If no valid diff lines found, return original
  if (diffLines.length === 0) {
    return normalizedDiff;
  }

  // Build the unified diff with proper headers
  const unifiedLines = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${oldLineCount} +1,${newLineCount} @@`,
    ...diffLines,
  ];

  return `${unifiedLines.join('\n')}\n`;
}

// Validation schemas
const ReferenceResolveSchema = z.object({
  workspaceId: z.string(),
  semanticId: z.string(),
});

const TerminalRunCommandSchema = z.object({
  workspaceId: z.string(),
  command: z.string(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeoutMs: z.number().optional(),
});

const PatchValidateSchema = z.object({
  workspaceId: z.string(),
  filePath: z.string(),
  diff: z.string(),
});

const PatchApplySchema = z.object({
  workspaceId: z.string(),
  filePath: z.string(),
  diff: z.string(),
  createBackup: z.boolean().optional(),
});

const PatchRevertSchema = z.object({
  workspaceId: z.string(),
  filePath: z.string(),
});

const CodebaseSearchSchema = z.object({
  workspaceId: z.string(),
  query: z.string(),
  type: z.enum(['symbol', 'text', 'file']).optional(),
});

// Terminal management
const activeTerminals = new Map<number, { process: any; output: string }>();
let terminalIdCounter = 0;

/**
 * Setup IPC handlers for note primitives
 */
export function setupNotesPrimitivesIPC() {
  logger.info('Setting up notes primitives IPC handlers');

  // Reference resolution
  ipcMain.handle(
    'reference:resolve',
    createSafeValidatedHandler(
      ReferenceResolveSchema,
      async (_, validated) =>
        await referenceResolver.resolve(validated.workspaceId, validated.semanticId),
      'reference:resolve',
    ),
  );

  // Terminal command execution
  ipcMain.handle(
    'terminal:runCommand',
    createSafeValidatedHandler(
      TerminalRunCommandSchema,
      async (_, validated) => {
        try {
          const workspace = await workspaceService.getWorkspace(
            createWorkspaceId(validated.workspaceId),
          );

          if (!workspace.ok) {
            return { ok: false, error: 'Workspace not found' };
          }

          const workspacePath =
            workspace.data.worktreePath || workspace.data.repositoryPath || workspace.data.path;
          if (!workspacePath) {
            return { ok: false, error: 'Workspace has no valid path' };
          }

          const cwd = validated.cwd || workspacePath;
          const env = { ...process.env, ...validated.env };
          const timeout = validated.timeoutMs || 60000;

          // Create terminal ID
          const terminalId = ++terminalIdCounter;

          // Execute command
          const childProcess = exec(
            validated.command,
            {
              cwd,
              env,
              timeout,
              windowsHide: true,
            },
            (error, stdout, stderr) => {
              const terminal = activeTerminals.get(terminalId);
              if (terminal) {
                terminal.output = stdout + stderr;
              }

              if (error) {
                logger.error('Command execution failed', error);
              }
            },
          );

          // Store terminal info
          activeTerminals.set(terminalId, {
            process: childProcess,
            output: '',
          });

          return { ok: true, data: { terminalId } };
        } catch (error) {
          logger.error('Failed to run command', error);
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Failed to run command',
          };
        }
      },
      'terminal:runCommand',
    ),
  );

  // Kill terminal process
  ipcMain.handle('terminal:killProcess', async (_, { terminalId }: { terminalId: number }) => {
    const terminal = activeTerminals.get(terminalId);
    if (terminal) {
      // exec() uses a shell, so child.kill() only kills the shell, not the command.
      // Use killChildProcessTree to kill the actual command underneath.
      await killChildProcessTree(terminal.process);
      activeTerminals.delete(terminalId);
      return { ok: true };
    }
    return { ok: false, error: 'Terminal not found' };
  });

  // Subscribe to terminal output
  // Note: Callbacks are NOT passed via IPC - they cannot be serialized.
  // Instead, the renderer listens for `terminal:output:${terminalId}` and `terminal:exit:${terminalId}` events
  ipcMain.handle('terminal:subscribeOutput', async (event, { terminalId }) => {
    const terminal = activeTerminals.get(terminalId);
    if (!terminal) {
      return { ok: false, error: 'Terminal not found' };
    }

    // Set up event listeners - send data via events to the renderer
    terminal.process.stdout?.on('data', (data: Buffer) => {
      event.sender.send(`terminal:output:${terminalId}`, data.toString());
    });

    terminal.process.stderr?.on('data', (data: Buffer) => {
      event.sender.send(`terminal:output:${terminalId}`, data.toString());
    });

    terminal.process.on('exit', (code: number) => {
      event.sender.send(`terminal:exit:${terminalId}`, code ?? 0);
      activeTerminals.delete(terminalId);
    });

    return { ok: true };
  });

  // Patch validation
  ipcMain.handle(
    'patch:validate',
    createSafeValidatedHandler(
      PatchValidateSchema,
      async (_, validated) => {
        try {
          const workspace = await workspaceService.getWorkspace(
            createWorkspaceId(validated.workspaceId),
          );

          if (!workspace.ok) {
            return { ok: false, error: 'Workspace not found' };
          }

          // Remote workspaces not yet supported for patch operations
          if (workspace.data.isRemote) {
            return { ok: false, error: 'Patch operations not yet supported for remote workspaces' };
          }

          const workspacePath =
            workspace.data.worktreePath || workspace.data.repositoryPath || workspace.data.path;
          if (!workspacePath) {
            return { ok: false, error: 'Workspace has no valid path' };
          }

          const filePath = join(workspacePath, validated.filePath);

          // Check if file exists
          if (!existsSync(filePath)) {
            return { ok: false, error: 'File not found' };
          }

          // Ensure the diff has proper unified diff format
          const unifiedDiff = ensureUnifiedDiffFormat(validated.diff, validated.filePath);

          // Try to apply patch in dry-run mode using git apply with temp file
          const { writeFile: writeTempFile, unlink: unlinkTemp } = await import('fs/promises');
          const { tmpdir } = await import('os');
          const tempPatchFile = join(tmpdir(), `patch-validate-${Date.now()}.patch`);

          try {
            await writeTempFile(tempPatchFile, unifiedDiff);
            // Try strict check first, then relaxed (-C0) if that fails
            try {
              await execAsync(`git apply --check "${tempPatchFile}"`, {
                cwd: workspacePath,
              });
            } catch {
              // Try with relaxed context matching
              await execAsync(`git apply --check -C0 "${tempPatchFile}"`, {
                cwd: workspacePath,
              });
            }
            return { ok: true };
          } catch  {
            // Git apply failed, patch won't apply cleanly
            return { ok: false, error: 'Patch cannot be applied cleanly' };
          } finally {
            // Clean up temp file
            try {
              await unlinkTemp(tempPatchFile);
            } catch {
              // Ignore cleanup errors
            }
          }
        } catch (error) {
          logger.error('Failed to validate patch', error);
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Failed to validate patch',
          };
        }
      },
      'patch:validate',
    ),
  );

  // Patch application
  ipcMain.handle(
    'patch:apply',
    createSafeValidatedHandler(
      PatchApplySchema,
      async (_, validated) => {
        let backupPath: string | null = null;

        try {
          const workspace = await workspaceService.getWorkspace(
            createWorkspaceId(validated.workspaceId),
          );

          if (!workspace.ok) {
            return { ok: false, error: 'Workspace not found' };
          }

          // Remote workspaces not yet supported for patch operations
          if (workspace.data.isRemote) {
            return { ok: false, error: 'Patch operations not yet supported for remote workspaces' };
          }

          const workspacePath =
            workspace.data.worktreePath || workspace.data.repositoryPath || workspace.data.path;
          if (!workspacePath) {
            return { ok: false, error: 'Workspace has no valid path' };
          }

          const filePath = join(workspacePath, validated.filePath);

          // Create backup if requested and file exists
          // Store backups in workspace metadata folder to keep repo clean
          // (new files don't need backups)
          if (validated.createBackup && existsSync(filePath)) {
            const backupsDir = getPatchBackupsDir(validated.workspaceId);
            await mkdir(backupsDir, { recursive: true });
            const timestamp = Date.now();
            const backupFileName = getBackupFileName(validated.filePath, timestamp);
            backupPath = join(backupsDir, backupFileName);
            await copyFile(filePath, backupPath);
            logger.debug('Created patch backup', { filePath, backupPath });
          }

          // Ensure the diff has proper unified diff format
          const unifiedDiff = ensureUnifiedDiffFormat(validated.diff, validated.filePath);
          logger.info('Applying patch with unified diff:', {
            originalDiff: validated.diff,
            unifiedDiff,
            wasModified: validated.diff !== unifiedDiff,
          });

          // Apply patch using git apply with a temp file (more reliable than echo)
          const { writeFile: writeTempFile, unlink: unlinkTemp } = await import('fs/promises');
          const { tmpdir } = await import('os');
          const tempPatchFile = join(tmpdir(), `patch-${Date.now()}.patch`);

          try {
            await writeTempFile(tempPatchFile, unifiedDiff);
            logger.info('Attempting git apply', { tempPatchFile, workspacePath });

            // Try strict apply first
            try {
              await execAsync(`git apply "${tempPatchFile}"`, {
                cwd: workspacePath,
              });
            } catch (strictError: any) {
              // If strict apply fails, try with relaxed context matching (-C0)
              // This helps when line numbers are slightly off
              logger.info('Strict apply failed, trying with -C0', {
                strictError: strictError.stderr || strictError.message,
              });
              await execAsync(`git apply -C0 "${tempPatchFile}"`, {
                cwd: workspacePath,
              });
            }

            // Keep backup file for potential revert - don't clean it up here
            // The revert handler will clean up the backup after successful revert

            return { ok: true };
          } catch (gitError: any) {
            // Log the full error for debugging
            logger.error('git apply failed', {
              error: gitError.message,
              stderr: gitError.stderr,
              stdout: gitError.stdout,
              tempPatchFile,
              unifiedDiff,
            });

            // Check if it's a conflict - keep backup for potential revert
            const errorMsg = gitError.stderr || gitError.message || '';
            if (errorMsg.includes('patch does not apply') || errorMsg.includes('does not apply')) {
              return { ok: false, error: 'Patch conflicts with current file', conflict: true };
            }
            throw gitError;
          } finally {
            // Clean up temp patch file
            try {
              await unlinkTemp(tempPatchFile);
            } catch {
              // Ignore cleanup errors
            }
          }
        } catch (error) {
          logger.error('Failed to apply patch', error);
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Failed to apply patch',
          };
        }
      },
      'patch:apply',
    ),
  );

  // Patch revert
  ipcMain.handle(
    'patch:revert',
    createSafeValidatedHandler(
      PatchRevertSchema,
      async (_, validated) => {
        try {
          const workspace = await workspaceService.getWorkspace(
            createWorkspaceId(validated.workspaceId),
          );

          if (!workspace.ok) {
            return { ok: false, error: 'Workspace not found' };
          }

          // Remote workspaces not yet supported for patch operations
          if (workspace.data.isRemote) {
            return { ok: false, error: 'Patch operations not yet supported for remote workspaces' };
          }

          const workspacePath =
            workspace.data.worktreePath || workspace.data.repositoryPath || workspace.data.path;
          if (!workspacePath) {
            return { ok: false, error: 'Workspace has no valid path' };
          }

          const filePath = join(workspacePath, validated.filePath);

          // Look for most recent backup in workspace metadata folder
          const backupsDir = getPatchBackupsDir(validated.workspaceId);
          let backups: string[] = [];

          try {
            const files = await readdir(backupsDir);
            // Find backups for this specific file by decoding the filename
            backups = files
              .filter((f) => {
                const decoded = decodeBackupFileName(f);
                return decoded && decoded.relativePath === validated.filePath;
              })
              .sort()
              .reverse();
          } catch {
            // Backups directory doesn't exist yet
          }

          logger.debug('Looking for backup files', {
            filePath,
            backupsDir,
            matchingBackups: backups,
          });

          if (backups.length > 0) {
            const backupPath = join(backupsDir, backups[0]);
            logger.info('Reverting from backup', { backupPath, filePath });
            await copyFile(backupPath, filePath);
            // Clean up backup
            await unlink(backupPath);
            return { ok: true };
          }

          // Try to revert using git
          try {
            await execAsync(`git checkout -- "${validated.filePath}"`, {
              cwd: workspace.data.path,
            });
            return { ok: true };
          } catch {
            return { ok: false, error: 'No backup found and git revert failed' };
          }
        } catch (error) {
          logger.error('Failed to revert patch', error);
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Failed to revert patch',
          };
        }
      },
      'patch:revert',
    ),
  );

  // Note: File reading is handled by the existing file:read handler in file.ipc.ts
  // The reference-resolver.service.ts uses that handler for reading files

  // Codebase search (for reference resolution)
  ipcMain.handle(
    'codebase:search',
    createSafeValidatedHandler(
      CodebaseSearchSchema,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (_, validated) => {
        try {
          // This would integrate with the actual codebase search
          // For now, return a placeholder
          return {
            ok: true,
            data: {
              results: [],
            },
          };
        } catch (error) {
          logger.error('Failed to search codebase', error);
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Failed to search codebase',
          };
        }
      },
      'codebase:search',
    ),
  );

  // Editor open handler removed - now handled by setupEditorIPC() in editor.ipc.ts
  // to avoid duplicate registration of 'editor:open' channel

  logger.info('Notes primitives IPC handlers setup complete');
}


/**
 * Cleanup all active terminal processes.
 * Should be called on app shutdown to prevent orphaned processes.
 */
export async function cleanupNoteTerminals(): Promise<void> {
  for (const [terminalId, terminal] of activeTerminals.entries()) {
    try {
      await killChildProcessTree(terminal.process);
      logger.debug('Killed note terminal on cleanup', { terminalId });
    } catch {
      // Process may already be dead
    }
  }
  activeTerminals.clear();
}
