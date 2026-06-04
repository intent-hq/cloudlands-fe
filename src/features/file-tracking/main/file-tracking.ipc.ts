import type { WorkspaceId } from '$shared/types/branded-ids';
/**
 * File Tracking IPC Handlers
 *
 * Electron IPC handlers for file tracking operations.
 * Supports both local and remote workspaces via SSH.
 */

import { ipcMain } from 'electron';
import { sendToWorkspaceWindows } from '../../system/main/system.ipc';
import { promises as fs } from 'fs';
import { z } from 'zod';
import { FileTrackingService } from './file-tracking.service';
import { Logger } from '$lib/utils/logger';
import { FILE_TRACKING_CHANNELS } from '$shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  FileTrackingInitSchema,
  FileTrackingSyncSchema,
  FileTrackingLoadSchema,
  FileTrackingLoadCommitsSchema,
  FileTrackingLoadOlderCommitsSchema,
  FileTrackingLoadTransitionsSchema,
  FileTrackingTrackChangeSchema,
  FileTrackingStageChangesSchema,
  FileTrackingUnstageChangesSchema,
  FileTrackingGetChangesSchema,
} from '../../../main/ipc-schemas';
import { execFileAsync } from '../../../shared/git/git-env';
import { gitService } from '../../git/main/git.service';
import { storeBlob } from '../../../shared/git/git-blob-storage';
import { protocolAdapter } from '../../protocol/main/protocol-adapter';
import { remoteRPCManager } from '../../../shared/main/remote-rpc-manager';
import { WorkspaceConfig } from '../../../shared/main/config';
import type { TrackedChange } from '../types';
import type { ChangeFilter } from './types';
import { syncGitIntegrationForWorkspace } from './file-tracking-sync';

const logger = new Logger({ category: 'FileTrackingIPC' });

// Cache of services per workspace
const services = new Map<string, FileTrackingService>();
// Git integrations are now managed in workspace.ipc.ts

const emptyChangesResult = { changes: [], truncated: false, totalCount: 0 };

function isVirtualFileTrackingWorkspace(workspaceId: string): boolean {
  return WorkspaceConfig.isVirtualWorkspace(workspaceId);
}

function logVirtualWorkspaceSkip(operation: string, workspaceId: string): void {
  logger.debug('Skipping file tracking for virtual workspace', { operation, workspaceId });
}

/**
 * Get or create a service for a workspace
 */
function getService(
  workspaceId: string,
  workspacePath: string,
  isRemote?: boolean,
): FileTrackingService {
  const existing = services.get(workspaceId);
  if (existing) {
    return existing;
  }
  const service = new FileTrackingService(workspaceId, workspacePath, isRemote);
  services.set(workspaceId, service);
  // Git integration is now set up in workspace.ipc.ts during workspace:open
  return service;
}

// Git integration is now set up in workspace.ipc.ts during workspace:open

/**
 * Clean up git integration for a workspace
 * OPTIMIZED: Properly cleanup service resources
 */
export async function cleanupGitIntegration(workspaceId: string): Promise<void> {
  try {
    // Git integrations are now managed in workspace.ipc.ts
    // We only clean up the file tracking service here

    // Clean up file tracking service
    const service = services.get(workspaceId);
    if (service) {
      // Force save any pending changes
      await service.forceSave();

      // Destroy the service (stops timers and cleans up resources)
      service.destroy();

      services.delete(workspaceId);
      logger.info('Cleaned up file tracking service for workspace', { workspaceId });
    }
  } catch (error) {
    logger.error('Failed to cleanup file tracking', error as Error, { workspaceId });
    // Don't throw - we want to clean up as much as possible
  }
}

// Git integration is now handled in workspace.ipc.ts

/**
 * Get the file tracking service for a workspace (for use by other main process services)
 * Returns null if workspace not found or service cannot be created
 */
export async function getServiceForWorkspace(
  workspaceId: string,
): Promise<FileTrackingService | null> {
  try {
    if (isVirtualFileTrackingWorkspace(workspaceId)) {
      logVirtualWorkspaceSkip('getServiceForWorkspace', workspaceId);
      return null;
    }

    const { path: workspacePath, isRemote } = await getWorkspaceInfo(workspaceId);
    return getService(workspaceId, workspacePath, isRemote);
  } catch (error) {
    logger.warn('Failed to get file tracking service for workspace', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Setup IPC handlers for file tracking
 */
export function setupFileTrackingIPC() {
  logger.info('Setting up file tracking IPC handlers');

  // Initialize git integration for a workspace
  ipcMain.handle(
    FILE_TRACKING_CHANNELS.INIT,
    createSafeValidatedHandler(
      FileTrackingInitSchema,
      async (_event, validated) => {
        try {
          // Git integration is now handled in workspace.ipc.ts during workspace:open
          // This is essentially a no-op now, just return success
          logger.debug('File tracking init called (no-op)', { workspaceId: validated.workspaceId });
          return { success: true };
        } catch (error) {
          logger.error('Failed to initialize file tracking', error as Error, {
            workspaceId: validated.workspaceId,
          });
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      FILE_TRACKING_CHANNELS.INIT,
    ),
  );

  // Clear tracked changes
  ipcMain.handle(
    FILE_TRACKING_CHANNELS.CLEAR,
    createSafeValidatedHandler(
      z.object({ workspaceId: z.string().min(1) }),
      async (_event, validated) => {
        try {
          if (isVirtualFileTrackingWorkspace(validated.workspaceId)) {
            logVirtualWorkspaceSkip('clear', validated.workspaceId);
            return { ok: true };
          }

          const { path: workspacePath, isRemote } = await getWorkspaceInfo(
            validated.workspaceId,
          );
          const service = getService(validated.workspaceId, workspacePath, isRemote);

          // Clear all tracked changes
          await service.clearAllChanges();

          logger.info('Cleared tracked changes for workspace', {
            workspaceId: validated.workspaceId,
          });
          return { ok: true };
        } catch (error) {
          logger.error('Failed to clear tracked changes', error as Error, {
            workspaceId: validated.workspaceId,
          });
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      FILE_TRACKING_CHANNELS.CLEAR,
    ),
  );

  // Sync git integration for a workspace (manual refresh)
  ipcMain.handle(
    FILE_TRACKING_CHANNELS.SYNC,
    createSafeValidatedHandler(
      FileTrackingSyncSchema,
      async (_event, validated) => {
        try {
          logger.debug('Syncing file tracking for workspace', {
            workspaceId: validated.workspaceId,
            force: validated.force,
          });
          return await syncGitIntegrationForWorkspace(
            validated.workspaceId,
            validated.force ?? false,
            global,
            logger,
          );
        } catch (error) {
          logger.error('Failed to sync file tracking', error as Error, {
            workspaceId: validated.workspaceId,
          });
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      FILE_TRACKING_CHANNELS.SYNC,
    ),
  );

  // Load tracked changes
  ipcMain.handle(
    FILE_TRACKING_CHANNELS.LOAD,
    createSafeValidatedHandler(
      FileTrackingLoadSchema,
      async (_event, validated) => {
        try {
          if (isVirtualFileTrackingWorkspace(validated.workspaceId)) {
            logVirtualWorkspaceSkip('load', validated.workspaceId);
            return emptyChangesResult;
          }

          const { path: workspacePath, isRemote } = await getWorkspaceInfo(
            validated.workspaceId,
          );
          const service = getService(validated.workspaceId, workspacePath, isRemote);
          const result = await service.getChanges();

          // Return the full result object with metadata
          return result;
        } catch (error) {
          logger.error('Failed to load tracked changes', error as Error, {
            workspaceId: validated.workspaceId,
          });
          return { changes: [], truncated: false, totalCount: 0 };
        }
      },
      FILE_TRACKING_CHANNELS.LOAD,
    ),
  );

  // Load recent commits (lightweight metadata for renderer)
  ipcMain.handle(
    FILE_TRACKING_CHANNELS.LOAD_COMMITS,
    createSafeValidatedHandler(
      FileTrackingLoadCommitsSchema,
      async (_event, validated) => {
        try {
          const { workspaceId, limit } = validated;

          if (isVirtualFileTrackingWorkspace(workspaceId)) {
            logVirtualWorkspaceSkip('loadCommits', workspaceId);
            return { commits: [], boundarySha: undefined };
          }

          // Check if this is a remote workspace
          const { path: workspacePath, isRemote } = await getWorkspaceInfo(workspaceId);

          if (isRemote) {
            // Remote workspace: run git log via RPC exec()
            try {
              const rpcClient = await remoteRPCManager.getClient(workspaceId);
              const maxCount = limit ?? 50;

              // Determine the current branch so we can compare against origin/<branch>
              // instead of @{u} (which is unreliable when upstream isn't set).
              const branchResult = await rpcClient
                .exec({
                  command: `cd "${workspacePath}" && git branch --show-current`,
                  timeout: 15000,
                })
                .then((r) => r.stdout.trim())
                .catch(() => '');

              // Use the same format as gitService._doGetHistory:
              // %H=hash, %an=author, %ae=email, %aI=date, %s=subject, %b=body
              // %x00 as commit delimiter, %x01 as field separator
              const logFormat = '--format=%H%x01%an%x01%ae%x01%aI%x01%s%x01%b%x00';
              const gitLogCmd = `cd "${workspacePath}" && git log --first-parent --no-merges -n ${maxCount} ${logFormat}`;

              // Run git log and unpushed check in parallel
              const [logResult, unpushedResult] = await Promise.all([
                rpcClient.exec({ command: gitLogCmd, timeout: 30000 }),
                branchResult
                  ? rpcClient
                      .exec({
                        command: `cd "${workspacePath}" && git log origin/${branchResult}..HEAD --format=%H`,
                        timeout: 15000,
                      })
                      .then((r) => ({
                        hashes: new Set(r.stdout.trim().split('\n').filter(Boolean)),
                        hasUpstream: true,
                      }))
                      .catch(() => ({
                        hashes: new Set<string>(),
                        hasUpstream: false,
                      }))
                  : Promise.resolve({
                      hashes: new Set<string>(),
                      hasUpstream: false,
                    }),
              ]);

              const logOutput = logResult.stdout;
              const unpushedHashes = unpushedResult.hashes;
              const hasUpstream = unpushedResult.hasUpstream;

              // Parse commits using the same logic as gitService._doGetHistory
              const commitBlocks = logOutput.split('\x00').filter(Boolean);
              const parsedCommits: Array<{
                hash: string;
                author: string;
                email: string;
                date: string;
                message: string;
                isPushed: boolean;
                agentId?: string;
                linkedNoteId?: string;
              }> = [];

              for (const block of commitBlocks) {
                const fields = block.split('\x01');
                if (fields.length < 5) continue;

                const [rawHash, author, email, date, subject, body = ''] = fields;
                const hash = rawHash.trim();
                if (!hash) continue;

                // Parse trailers from body
                let agentId: string | undefined;
                let linkedNoteId: string | undefined;
                const bodyLines = body.trim().split('\n');
                for (const line of bodyLines) {
                  const agentMatch = line.match(/^Agent-Id:\s*(.+)$/);
                  if (agentMatch) agentId = agentMatch[1].trim();
                  const noteMatch = line.match(/^Linked-Note-Id:\s*(.+)$/);
                  if (noteMatch) linkedNoteId = noteMatch[1].trim();
                }

                // Determine pushed status
                let isPushed = false;
                if (hasUpstream) {
                  isPushed = !unpushedHashes.has(hash);
                }

                parsedCommits.push({
                  hash,
                  author,
                  email,
                  date,
                  message: subject,
                  isPushed,
                  agentId,
                  linkedNoteId,
                });
              }

              // Batch file lookups via a single git show command
              const filesByHash = new Map<string, string[]>();
              if (parsedCommits.length > 0) {
                try {
                  const commitHashes = parsedCommits.map((c) => c.hash).join(' ');
                  const filesResult = await rpcClient.exec({
                    command: `cd "${workspacePath}" && git show --name-only --format="FILES_FOR:%H" ${commitHashes}`,
                    timeout: 30000,
                  });
                  const sections = filesResult.stdout.split('FILES_FOR:').filter(Boolean);
                  for (const section of sections) {
                    const lines = section.trim().split('\n');
                    const sectionHash = lines[0].trim();
                    const files = lines.slice(1).filter((l) => l.trim().length > 0);
                    filesByHash.set(sectionHash, files);
                  }
                } catch (err) {
                  logger.warn('Remote: Batch file lookup failed, files will be empty', {
                    workspaceId,
                    error: (err as Error).message,
                  });
                }
              }

              // Map to the same output format as the local path
              const mapped = parsedCommits.map((commit) => {
                const files = (filesByHash.get(commit.hash) || []).map((f) => ({
                  path: f,
                }));
                const stage = commit.isPushed
                  ? ('pushed' as const)
                  : ('local' as const);

                return {
                  hash: commit.hash,
                  message: commit.message || commit.hash,
                  author: commit.author || '',
                  authorEmail: commit.email,
                  date: commit.date,
                  timestamp: commit.date ? Date.parse(commit.date) : Date.now(),
                  files,
                  filesChanged: files.length,
                  stage,
                  isPushed: commit.isPushed,
                  prNumber: undefined,
                  agentId: commit.agentId,
                  linkedNoteId: commit.linkedNoteId,
                };
              });

              logger.info('Loaded remote commit history for renderer', {
                workspaceId,
                count: mapped.length,
              });

              return { commits: mapped, boundarySha: undefined };
            } catch (remoteError) {
              logger.error('Failed to load remote commit history', remoteError as Error, {
                workspaceId,
              });
              return { commits: [], boundarySha: undefined };
            }
          }

          // Local workspace: use gitService.getHistory() as before
          // Get workspace info to filter commits to only those on this workspace's branch
          const workspace = await protocolAdapter.getWorkspace(workspaceId);
          const baseRef = workspace?.baseRef;
          const baseCommitSha = workspace?.baseCommitSha;
          // Use workspace creation date as a fallback filter if merge-base and baseCommitSha both fail
          const since = workspace?.createdAt;

          const commitsResult = await gitService.getHistory(
            workspaceId as WorkspaceId,
            limit ?? 50,
            since,
            baseRef,
            baseCommitSha,
          );

          if (!commitsResult.ok) {
            logger.warn('Failed to load commit history', {
              workspaceId,
              error: commitsResult.error,
            });
            return { commits: [], boundarySha: undefined };
          }

          const { commits, boundarySha } = commitsResult.data;
          if (!commits) {
            return { commits: [], boundarySha };
          }

          // CommitInfo from gitService includes extended properties beyond the base type
          type ExtendedCommitInfo = (typeof commits)[number] & {
            isPushed?: boolean;
            agentId?: string;
            linkedNoteId?: string;
          };

          const mapped = (commits as ExtendedCommitInfo[]).map((commit) => {
            const hash = commit.hash || commit.sha || '';
            let files: { path: string }[] = [];
            if (Array.isArray(commit.files)) {
              files = commit.files.map((file) => ({
                path: typeof file === 'string' ? file : String(file),
              }));
            }
            const filesChanged = files.length;
            // Use isPushed from git service, default to 'local' stage
            const isPushed = commit.isPushed ?? false;
            const stage = isPushed ? ('pushed' as const) : ('local' as const);

            return {
              hash,
              message: commit.message || hash,
              author: commit.author || '',
              authorEmail: commit.email,
              date: commit.date,
              timestamp: commit.date ? Date.parse(commit.date) : Date.now(),
              files,
              filesChanged,
              stage,
              isPushed,
              prNumber: undefined,
              // Agent attribution from commit trailers
              agentId: commit.agentId,
              linkedNoteId: commit.linkedNoteId,
            };
          });

          logger.info('Loaded commit history for renderer', {
            workspaceId,
            count: mapped.length,
            boundarySha: boundarySha?.slice(0, 8),
            baseRef,
            baseCommitSha: baseCommitSha?.slice(0, 8),
            commits: mapped.map((c) => ({
              hash: c.hash.slice(0, 8),
              message: c.message.slice(0, 30),
              isPushed: c.isPushed,
              stage: c.stage,
              agentId: c.agentId?.slice(0, 16),
            })),
          });

          return { commits: mapped, boundarySha };
        } catch (error) {
          logger.error('Failed to load commit history', error as Error, {
            workspaceId: validated.workspaceId,
          });
          return { commits: [], boundarySha: undefined };
        }
      },
      FILE_TRACKING_CHANNELS.LOAD_COMMITS,
    ),
  );

  // Load older commits (before a given SHA, for "show older" UI)
  ipcMain.handle(
    FILE_TRACKING_CHANNELS.LOAD_OLDER_COMMITS,
    createSafeValidatedHandler(
      FileTrackingLoadOlderCommitsSchema,
      async (_event, validated) => {
        try {
          const { workspaceId, beforeSha, limit } = validated;
          const maxCount = limit ?? 10;

          if (isVirtualFileTrackingWorkspace(workspaceId)) {
            logVirtualWorkspaceSkip('loadOlderCommits', workspaceId);
            return { commits: [] };
          }

          // Get workspace info for the worktree path and remote status
          const { path: workspacePath, isRemote } = await getWorkspaceInfo(workspaceId);

          let stdout: string;

          if (isRemote) {
            // Remote workspace: run git log via RPC exec()
            const rpcClient = await remoteRPCManager.getClient(workspaceId);
            const result = await rpcClient.exec({
              command: `cd "${workspacePath}" && git log --first-parent --no-merges --max-count=${maxCount} --format=%H%n%s%n%an%n%ae%n%aI ${beforeSha}`,
              timeout: 30000,
            });
            stdout = result.stdout;
          } else {
            // Local workspace: use execFileAsync as before
            const result = await execFileAsync(
              'git',
              ['log', '--first-parent', '--no-merges', `--max-count=${maxCount}`, '--format=%H%n%s%n%an%n%ae%n%aI', beforeSha],
              { cwd: workspacePath },
            );
            stdout = result.stdout;
          }

          if (!stdout.trim()) {
            logger.warn('No older commits found', {
              workspaceId,
              beforeSha,
            });
            return { commits: [] };
          }

          const lines = stdout.trim().split('\n');
          const commits: Array<{
            hash: string;
            message: string;
            author: string;
            authorEmail?: string;
            timestamp: number;
            date?: string;
            files: Array<{ path: string }>;
            filesChanged: number;
            stage: 'local' | 'pushed';
            isPushed: boolean;
          }> = [];

          // Parse 5-line groups: hash, message, author, email, date
          for (let i = 0; i + 4 < lines.length; i += 5) {
            const hash = lines[i].trim();
            const message = lines[i + 1].trim();
            const author = lines[i + 2].trim();
            const authorEmail = lines[i + 3].trim();
            const date = lines[i + 4].trim();

            if (!hash) continue;

            commits.push({
              hash,
              message: message || hash,
              author: author || '',
              authorEmail,
              date,
              timestamp: date ? Date.parse(date) : Date.now(),
              files: [],
              filesChanged: 0,
              stage: 'pushed',
              isPushed: true,
            });
          }

          logger.info('Loaded older commits', {
            workspaceId,
            beforeSha: beforeSha.slice(0, 8),
            count: commits.length,
          });

          return { commits };
        } catch (error) {
          logger.error('Failed to load older commits', error as Error, {
            workspaceId: validated.workspaceId,
          });
          return { commits: [] };
        }
      },
      FILE_TRACKING_CHANNELS.LOAD_OLDER_COMMITS,
    ),
  );

  // Load transitions
  ipcMain.handle(
    FILE_TRACKING_CHANNELS.LOAD_TRANSITIONS,
    createSafeValidatedHandler(
      FileTrackingLoadTransitionsSchema,
      async (_event, validated) => {
        try {
          if (isVirtualFileTrackingWorkspace(validated.workspaceId)) {
            logVirtualWorkspaceSkip('loadTransitions', validated.workspaceId);
            return [];
          }

          const { path: workspacePath, isRemote } = await getWorkspaceInfo(
            validated.workspaceId,
          );
          const service = getService(validated.workspaceId, workspacePath, isRemote);
          const transitions = await service.getTransitions();
          return transitions;
        } catch (error) {
          logger.error('Failed to load transitions', error as Error, {
            workspaceId: validated.workspaceId,
          });
          return [];
        }
      },
      FILE_TRACKING_CHANNELS.LOAD_TRANSITIONS,
    ),
  );

  // Track a new change and save it to storage
  ipcMain.handle(
    FILE_TRACKING_CHANNELS.TRACK_CHANGE,
    createSafeValidatedHandler(
      FileTrackingTrackChangeSchema,
      async (_event, validated) => {
        try {
          if (isVirtualFileTrackingWorkspace(validated.workspaceId)) {
            logVirtualWorkspaceSkip('trackChange', validated.workspaceId);
            return { ok: true, change: null };
          }

          const { path: workspacePath, isRemote } = await getWorkspaceInfo(
            validated.workspaceId,
          );
          const service = getService(validated.workspaceId, workspacePath, isRemote);

          // Store content as git blobs when possible
          let content = validated.change.content;
          if (content && workspacePath && service.isGitRepo()) {
            const blobContent: TrackedChange['content'] & {} = { ...content };
            if (blobContent.newContent) {
              const sha = await storeBlob(blobContent.newContent, workspacePath);
              if (sha) {
                blobContent.newContentSha = sha;
                delete blobContent.newContent;
              }
            }
            if (blobContent.oldContent) {
              const sha = await storeBlob(blobContent.oldContent, workspacePath);
              if (sha) {
                blobContent.oldContentSha = sha;
                delete blobContent.oldContent;
              }
            }
            if (blobContent.diff && blobContent.diff.length > 10_000) {
              const sha = await storeBlob(blobContent.diff, workspacePath);
              if (sha) {
                blobContent.diffSha = sha;
                delete blobContent.diff;
              }
            }
            content = blobContent;
          }

          // Convert validated change to service-expected format
          const changeInput = {
            file: validated.change.file,
            relativePath: validated.change.relativePath ?? validated.change.file,
            stage: validated.change.stage as TrackedChange['stage'],
            stats: validated.change.stats ?? { additions: 0, deletions: 0 },
            status: validated.change.type as TrackedChange['status'],
            attribution: validated.change.attribution ?? { timestamp: Date.now() },
            commitHash: validated.change.commitHash,
            prNumber: validated.change.prNumber,
            content,
          };
          const trackedChange = await service.trackChange(changeInput);

          // Also sync with git to ensure the change is reflected in git status
          // This is important for agent-created files to show up immediately
          // Skip committed changes for performance (includeCommitted=false)
          const gitIntegration = global.gitIntegrations?.get(validated.workspaceId);
          if (gitIntegration) {
            try {
              await gitIntegration.syncCurrentState(false, false);
              logger.debug('Synced with git after tracking change', {
                workspaceId: validated.workspaceId,
                file: validated.change.file,
              });
            } catch (syncError) {
              logger.warn('Failed to sync with git after tracking change', syncError as Error);
            }
          }

          // Emit workspace-changes event to notify UI components
          // This ensures the CodeChangesPanel updates when agents create files
          sendToWorkspaceWindows(validated.workspaceId, 'workspace-changes', {
            workspaceId: validated.workspaceId,
            source: 'file-tracking',
            changeCount: 1,
            files: [validated.change.file || validated.change.relativePath],
          });

          return { ok: true, change: trackedChange };
        } catch (error) {
          logger.error('Failed to track change', error as Error, {
            workspaceId: validated.workspaceId,
          });
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      FILE_TRACKING_CHANNELS.TRACK_CHANGE,
    ),
  );

  // Stage changes
  ipcMain.handle(
    FILE_TRACKING_CHANNELS.STAGE_CHANGES,
    createSafeValidatedHandler(
      FileTrackingStageChangesSchema,
      async (_event, validated) => {
        try {
          if (isVirtualFileTrackingWorkspace(validated.workspaceId)) {
            logVirtualWorkspaceSkip('stageChanges', validated.workspaceId);
            return { ok: true };
          }

          const { path: workspacePath, isRemote } = await getWorkspaceInfo(
            validated.workspaceId,
          );
          const service = getService(validated.workspaceId, workspacePath, isRemote);

          // Extract file paths from changeIds for stage operation suppression
          // This matches the logic in FileTrackingService.executeStageOperation
          const filePathsFromIds = validated.changeIds
            .filter((id: string) => id.startsWith('git-'))
            .map((id: string) => id.replace(/^git-(\d+-|path-)/, ''));

          // Begin stage operation suppression BEFORE running the git command
          // This prevents the UI from receiving 'changes-tracked' events that
          // would revert the optimistic update
          const gitIntegration = global.gitIntegrations?.get(validated.workspaceId);
          if (gitIntegration && filePathsFromIds.length > 0) {
            gitIntegration.beginStageOperation(filePathsFromIds);
          }

          await service.stageChanges(validated.changeIds);

          // Clear GitService's status cache so AcceptChangesPanel.prepare() gets fresh data.
          // FileTrackingService runs git commands directly and bypasses GitService,
          // so we need to manually invalidate GitService's cache.
          gitService.clearStatusCache(validated.workspaceId as WorkspaceId);

          // Invalidate the ChangeDetector's git status cache so the next poll gets fresh status.
          // This prevents the ChangeProcessor from using stale cached status.
          if (gitIntegration) {
            gitIntegration.invalidateGitStatusCache();
          }

          return { ok: true };
        } catch (error) {
          logger.error('Failed to stage changes', error as Error, {
            workspaceId: validated.workspaceId,
          });

          // End stage operation suppression on error
          const gitIntegration = global.gitIntegrations?.get(validated.workspaceId);
          if (gitIntegration) {
            gitIntegration.endStageOperation();
          }

          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      FILE_TRACKING_CHANNELS.STAGE_CHANGES,
    ),
  );

  // Unstage changes
  ipcMain.handle(
    FILE_TRACKING_CHANNELS.UNSTAGE_CHANGES,
    createSafeValidatedHandler(
      FileTrackingUnstageChangesSchema,
      async (_event, validated) => {
        try {
          if (isVirtualFileTrackingWorkspace(validated.workspaceId)) {
            logVirtualWorkspaceSkip('unstageChanges', validated.workspaceId);
            return { ok: true };
          }

          const { path: workspacePath, isRemote } = await getWorkspaceInfo(
            validated.workspaceId,
          );
          const service = getService(validated.workspaceId, workspacePath, isRemote);

          // Extract file paths from changeIds for stage operation suppression
          // This matches the logic in FileTrackingService.executeStageOperation
          const filePathsFromIds = validated.changeIds
            .filter((id: string) => id.startsWith('git-'))
            .map((id: string) => id.replace(/^git-(\d+-|path-)/, ''));

          // Begin stage operation suppression BEFORE running the git command
          // This prevents the UI from receiving 'changes-tracked' events that
          // would revert the optimistic update
          const gitIntegration = global.gitIntegrations?.get(validated.workspaceId);
          if (gitIntegration && filePathsFromIds.length > 0) {
            gitIntegration.beginStageOperation(filePathsFromIds);
          }

          await service.unstageChanges(validated.changeIds);

          // Clear GitService's status cache so AcceptChangesPanel.prepare() gets fresh data.
          // FileTrackingService runs git commands directly and bypasses GitService,
          // so we need to manually invalidate GitService's cache.
          gitService.clearStatusCache(validated.workspaceId as WorkspaceId);

          // Invalidate the ChangeDetector's git status cache so the next poll gets fresh status.
          // This prevents the ChangeProcessor from using stale cached status.
          if (gitIntegration) {
            gitIntegration.invalidateGitStatusCache();
          }

          return { ok: true };
        } catch (error) {
          logger.error('Failed to unstage changes', error as Error, {
            workspaceId: validated.workspaceId,
          });

          // End stage operation suppression on error
          const gitIntegration = global.gitIntegrations?.get(validated.workspaceId);
          if (gitIntegration) {
            gitIntegration.endStageOperation();
          }

          return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      },
      FILE_TRACKING_CHANNELS.UNSTAGE_CHANGES,
    ),
  );

  // Get filtered changes
  ipcMain.handle(
    FILE_TRACKING_CHANNELS.GET_CHANGES,
    createSafeValidatedHandler(
      FileTrackingGetChangesSchema,
      async (_event, validated) => {
        try {
          if (isVirtualFileTrackingWorkspace(validated.workspaceId)) {
            logVirtualWorkspaceSkip('getChanges', validated.workspaceId);
            return { ok: true, changes: emptyChangesResult };
          }

          const { path: workspacePath, isRemote } = await getWorkspaceInfo(
            validated.workspaceId,
          );
          const service = getService(validated.workspaceId, workspacePath, isRemote);
          const changes = await service.getChanges(validated.filter as ChangeFilter | undefined);

          return { ok: true, changes };
        } catch (error) {
          logger.error('Failed to get changes', error as Error, {
            workspaceId: validated.workspaceId,
          });
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            changes: [],
          };
        }
      },
      FILE_TRACKING_CHANNELS.GET_CHANGES,
    ),
  );

  // Get line stats (additions/deletions) for a workspace - used by home view for real-time stats
  // Note: Using literal string to work around TypeScript inference issue with const object
  const LINE_STATS_CHANNEL = 'file-tracking:get-line-stats' as const;
  const lineStatsSchema = z.object({
    workspaceId: z.string().min(1, 'Workspace ID is required'),
  });
  ipcMain.handle(
    LINE_STATS_CHANNEL,
    createSafeValidatedHandler(
      lineStatsSchema,
      async (_event, validated) => {
        try {
          if (isVirtualFileTrackingWorkspace(validated.workspaceId)) {
            logVirtualWorkspaceSkip('getLineStats', validated.workspaceId);
            return {
              ok: true,
              data: { additions: 0, deletions: 0 },
            };
          }

          const { path: workspacePath, isRemote } = await getWorkspaceInfo(
            validated.workspaceId,
          );
          const service = getService(validated.workspaceId, workspacePath, isRemote);

          // Get tracked changes (unstaged + staged)
          const changesResult = await service.getChanges();

          // Calculate line stats from tracked changes
          let additions = 0;
          let deletions = 0;

          // Sum up from tracked changes (unstaged + staged)
          for (const change of changesResult.changes) {
            additions += change.stats?.additions || 0;
            deletions += change.stats?.deletions || 0;
          }

          return {
            ok: true,
            data: { additions, deletions },
          };
        } catch (error) {
          // "Workspace not found" is expected during/after deletion - log at debug level
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const isNotFound = errorMessage.includes('not found');
          if (isNotFound) {
            logger.debug('Workspace not found for line stats (likely deleted)', {
              workspaceId: validated.workspaceId,
            });
          } else {
            logger.error('Failed to get line stats', error as Error, {
              workspaceId: validated.workspaceId,
            });
          }
          return {
            ok: false,
            error: errorMessage,
            data: { additions: 0, deletions: 0 },
          };
        }
      },
      LINE_STATS_CHANNEL,
    ),
  );

  logger.info('File tracking IPC handlers setup complete');
}

/**
 * Helper to get workspace path and remote status
 */
interface WorkspaceInfo {
  path: string;
  isRemote?: boolean;
}

async function getWorkspaceInfo(workspaceId: string): Promise<WorkspaceInfo> {
  // Import workspace service to get actual path
  const { workspaceService } = await import('../../workspace/main/workspace.service');
  const result = await workspaceService.getWorkspace(workspaceId as WorkspaceId);

  if (!result.ok || !result.data) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  const workspace = result.data as {
    worktreePath?: string;
    repositoryPath?: string;
    path?: string;
    isRemote?: boolean;
  };

  const effectivePath = workspace.worktreePath || workspace.repositoryPath || workspace.path;

  if (!effectivePath) {
    throw new Error(
      `Workspace ${workspaceId} has no worktree, repository, or workspace path defined`,
    );
  }

  // For local workspaces, verify path exists
  if (!workspace.isRemote) {
    try {
      await fs.access(effectivePath);
    } catch {
      // Only create if this is the workspace base path; for repo/worktree we surface an error
      if (effectivePath === workspace.path) {
        await fs.mkdir(effectivePath, { recursive: true });
      } else {
        throw new Error(`Workspace ${workspaceId} path does not exist on disk: ${effectivePath}`);
      }
    }
  }

  return { path: effectivePath, isRemote: workspace.isRemote };
}
