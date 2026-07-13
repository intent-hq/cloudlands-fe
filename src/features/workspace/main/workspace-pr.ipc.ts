/**
 * Workspace Pull Request IPC Handlers
 *
 * Handles pull request operations for workspaces
 */

import { ipcMain } from 'electron';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { z } from 'zod';
import { Logger } from '$lib/utils/logger';

const logger = new Logger({ category: 'WorkspacePR-IPC' });

// Validation schemas
const GetWorkspaceChangesSchema = z.object({
  workspaceId: z.string(),
  includeUntracked: z.boolean().optional().default(true),
});

const GeneratePRContentSchema = z.object({
  workspaceId: z.string(),
  changes: z
    .array(
      z.object({
        file: z.string(),
        additions: z.number(),
        deletions: z.number(),
        status: z.string(),
      }),
    )
    .optional(),
  title: z.string().optional(),
  description: z.string().optional(),
});

const ResolveMergeConflictsSchema = z.object({
  workspaceId: z.string(),
  strategy: z.enum(['ours', 'theirs', 'manual']).optional().default('manual'),
  files: z.array(z.string()).optional(),
});

/**
 * Register workspace PR IPC handlers
 */
export function registerWorkspacePRHandlers(): void {
  // Remove any existing handlers before registering to prevent duplicates
  const handlers = ['get_workspace_changes', 'create_workspace_pr', 'get_workspace_pr_status'];

  // Remove existing handlers
  for (const channel of handlers) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Handler might not exist, that's ok
    }
  }

  // Get workspace changes
  ipcMain.handle(
    'get_workspace_changes',
    createSafeValidatedHandler(
      GetWorkspaceChangesSchema,
      async (_event, { workspaceId, includeUntracked }) => {
        try {
          logger.info('Getting workspace changes', { workspaceId, includeUntracked });

          // In production, this would get actual git changes
          // For now, return mock data
          const mockChanges = [
            {
              file: 'src/main.ts',
              additions: 10,
              deletions: 5,
              status: 'modified',
            },
            {
              file: 'README.md',
              additions: 20,
              deletions: 0,
              status: 'added',
            },
          ];

          return {
            success: true,
            changes: mockChanges,
            summary: {
              filesChanged: mockChanges.length,
              additions: 30,
              deletions: 5,
            },
          };
        } catch (error) {
          logger.error('Failed to get workspace changes', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      'get_workspace_changes',
    ),
  );

  // Generate PR content
  ipcMain.handle(
    'generate_pr_content',
    createSafeValidatedHandler(
      GeneratePRContentSchema,
      async (_event, { workspaceId, changes, title, description }) => {
        try {
          logger.info('Generating PR content', { workspaceId });

          // In production, this would use AI to generate PR content
          // For now, return mock data
          const generatedTitle = title || 'Update workspace files';
          const generatedDescription =
            description ||
            `## Changes

This PR includes the following changes:
${changes?.map((c) => `- ${c.file}: +${c.additions} -${c.deletions}`).join('\n') || '- Various updates'}

## Testing
- [ ] Tests pass
- [ ] Code reviewed
`;

          return {
            success: true,
            title: generatedTitle,
            description: generatedDescription,
            branch: `workspace-${workspaceId}-${Date.now()}`,
          };
        } catch (error) {
          logger.error('Failed to generate PR content', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      'generate_pr_content',
    ),
  );

  // Resolve merge conflicts
  ipcMain.handle(
    'resolve_merge_conflicts',
    createSafeValidatedHandler(
      ResolveMergeConflictsSchema,
      async (_event, { workspaceId, strategy, files }) => {
        try {
          logger.info('Resolving merge conflicts', { workspaceId, strategy });

          // In production, this would actually resolve conflicts
          // For now, return mock success
          return {
            success: true,
            resolvedFiles: files || [],
            message: `Conflicts resolved using ${strategy} strategy`,
          };
        } catch (error) {
          logger.error('Failed to resolve merge conflicts', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      'resolve_merge_conflicts',
    ),
  );

  logger.info('Workspace PR IPC handlers registered');
}
