/**
 * Agent Launch Core Helpers
 *
 * Core helper functions for the agent launch system:
 * - Rules file resolution (workspace → user fallback)
 * - Workspace context assembly
 * - Dynamic message building
 * - Context format conversion
 */

import type { ContextReference } from './agent-context';
import { thirdPartySourcesClient } from '$features/third-party-sources/third-party-sources.client';
import { createLogger } from '$lib/utils/client-logger';
import { WorkspaceId } from '$shared/types/branded-ids';

const logger = createLogger('agent-launch-core');

/**
 * Build workspace context from context references
 *
 * Creates a minimal context string with workspace path and file list.
 * This gets passed via STDIN to auggie.
 *
 * @param workspacePath - Path to workspace root
 * @param references - Context references (files, selections, etc.)
 * @param workspaceId - Optional workspace ID for fetching third-party sources
 * @returns Context string for STDIN
 */
export function buildWorkspaceContext(
  workspacePath: string,
  references: ContextReference[],
): string {
  const lines = [`Workspace: ${workspacePath}`, ''];

  // Extract file paths from references
  const filePaths = references
    .filter((ref) => ref.type === 'file' || ref.type === 'selection')
    .map((ref) => {
      if (ref.type === 'file') {
        return ref.filePath;
      } else if (ref.type === 'selection' && ref.surroundingContext?.filePath) {
        return ref.surroundingContext.filePath;
      }
      return undefined;
    })
    .filter((path): path is string => path !== undefined);

  if (filePaths.length > 0) {
    lines.push('Files in context:');
    filePaths.forEach((path) => {
      lines.push(`- ${path}`);
    });
  }

  // Check for spec references
  const hasSpecRef = references.some((ref) => ref.type === 'spec');
  if (hasSpecRef) {
    if (lines.length > 2) {
      lines.push('');
    }
    lines.push(
      "Spec: Available as a note with ID 'spec' (use read_note with noteId='spec' to read, add_to_note to add content, edit_note to modify)",
    );
  }

  // Check for note references
  const noteRefs = references.filter((ref) => ref.type === 'note');
  if (noteRefs.length > 0) {
    if (lines.length > 2) {
      lines.push('');
    }
    lines.push('Notes in context:');
    noteRefs.forEach((ref) => {
      if (ref.noteId) {
        lines.push(`- Note ID: ${ref.noteId}`);
      }
    });
  }

  // Check for terminal references - include terminal output directly
  const terminalRefs = references.filter((ref) => ref.type === 'terminal');
  if (terminalRefs.length > 0) {
    if (lines.length > 2) {
      lines.push('');
    }
    lines.push('Terminal output in context:');
    terminalRefs.forEach((ref) => {
      if (ref.terminalContent) {
        const label = ref.metadata?.terminalName || 'Terminal';
        const terminalId = ref.metadata?.terminalId;
        lines.push(`\n--- ${label} (terminal_id: ${terminalId || 'unknown'}) ---`);
        lines.push(ref.terminalContent);
        lines.push(`--- End ${label} ---`);
      }
    });
  }

  return lines.join('\n');
}

/**
 * Build workspace context with third-party sources
 *
 * Enhanced version that includes third-party sources in the context.
 *
 * @param workspacePath - Path to workspace root
 * @param workspaceId - Workspace ID for fetching third-party sources
 * @param references - Context references
 * @returns Context string for STDIN
 */
export async function buildWorkspaceContextWithSources(
  workspacePath: string,
  workspaceId: string,
  references: ContextReference[],
): Promise<string> {
  // Start with basic context
  let context = buildWorkspaceContext(workspacePath, references);

  try {
    // Fetch third-party sources
    const sourcesResponse = await thirdPartySourcesClient.list(WorkspaceId(workspaceId));

    if (sourcesResponse.success && sourcesResponse.data && sourcesResponse.data.length > 0) {
      const sources = sourcesResponse.data;

      const lines = context.split('\n');
      lines.push('');
      lines.push('External References:');

      for (const source of sources) {
        lines.push(`- ${source.title}`);
        lines.push(`  URL: ${source.url}`);
        lines.push(`  Type: ${source.type.replace(/_/g, ' ')}`);

        if (source.description) {
          lines.push(`  Description: ${source.description}`);
        }

        // Include extracted content if available
        if (source.metadata?.extractedContent) {
          lines.push('  Content Preview:');
          const preview = source.metadata.extractedContent.substring(0, 500);
          lines.push(`  ${preview}${source.metadata.extractedContent.length > 500 ? '...' : ''}`);
        }

        lines.push('');
      }

      context = lines.join('\n');
    }
  } catch (err) {
    logger.warn('Failed to fetch third-party sources for context', err);
    // Continue without sources rather than failing
  }

  return context;
}

/**
 * Build dynamic message from user message and context references
 *
 * Creates the focused first message that includes:
 * - User's message/request
 * - Specific context (file, selection, task, etc.)
 * - Workspace renaming instruction (if workspace title is empty)
 *
 * This is what gets passed to auggie via --print.
 *
 * @param userMessage - User's message/request
 * @param references - Context references
 * @param workspaceTitle - Current workspace title (optional)
 * @returns Dynamic message string
 */
export function buildDynamicMessage(
  userMessage: string | undefined,
  references: ContextReference[],
  workspaceTitle?: string,
): string {
  const lines: string[] = [];

  // Add space renaming instruction if title is empty
  if (!workspaceTitle || workspaceTitle.trim() === '') {
    lines.push('⚠️ **IMPORTANT - FIRST STEP:**');
    lines.push(
      'The space title is empty. You MUST rename it immediately using `set_workspace_title_workspace-mcp`.',
    );
    lines.push('Extract a short, descriptive name (1-5 words) from the task/spec goal.');
    lines.push("Examples: 'Dark Mode Feature', 'Fix Login Bug', 'Add Search', 'Refactor Database'");
    lines.push('');
  }

  // Add user message if provided
  if (userMessage) {
    lines.push(userMessage);
  }

  // Add context details
  if (references.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('Context:');

    references.forEach((ref) => {
      switch (ref.type) {
        case 'file':
          lines.push(`File: ${ref.filePath}`);
          if (ref.lineNumber !== undefined) {
            lines.push(`Line: ${ref.lineNumber}`);
          }
          break;

        case 'selection':
          if (ref.surroundingContext?.filePath) {
            lines.push(`File: ${ref.surroundingContext.filePath}`);
          }
          if (
            ref.surroundingContext?.startLine !== undefined &&
            ref.surroundingContext?.endLine !== undefined
          ) {
            lines.push(
              `Lines ${ref.surroundingContext.startLine}-${ref.surroundingContext.endLine}:`,
            );
          }
          if (ref.selectedText) {
            lines.push('');
            lines.push(ref.selectedText);
          }
          break;

        case 'task':
          lines.push(`Task: ${ref.taskText}`);
          if (ref.taskPosition !== undefined) {
            lines.push(`Position: ${ref.taskPosition}`);
          }
          if (ref.taskChecked !== undefined) {
            lines.push(`Status: ${ref.taskChecked ? 'Completed' : 'Pending'}`);
          }
          if (ref.surroundingContext?.before) {
            lines.push('Previous task:', ref.surroundingContext.before);
          }
          if (ref.surroundingContext?.after) {
            lines.push('Next task:', ref.surroundingContext.after);
          }
          if (ref.metadata) {
            lines.push(`Metadata: ${JSON.stringify(ref.metadata, null, 2)}`);
          }
          break;

        case 'code_chunk':
          lines.push('Code Chunk:');
          if (ref.codeChunk) {
            lines.push('');
            lines.push(ref.codeChunk);
          }
          break;

        case 'spec':
          lines.push('');
          lines.push("The space specification (stored as a note with ID 'spec').");
          lines.push('');
          lines.push('**IMPORTANT: Use MCP tools to read/write the spec:**');
          lines.push('- Read the spec: read_note_workspace-mcp(noteId="spec")');
          lines.push('- Add to the spec: add_to_note_workspace-mcp(noteId="spec", content="...")');
          lines.push(
            '- Add comments/suggestions: add_note_comment_workspace-mcp(noteId="spec", ...)',
          );
          lines.push('- The spec contains the goals, requirements, and features for this space');
          lines.push('');
          lines.push('**Space Naming:**');
          lines.push('- Check if space has a title: get_workspace_details_workspace-mcp()');
          lines.push(
            '- If hasTitle is false or title is generic, use set_workspace_title_workspace-mcp()',
          );
          lines.push('- Keep the name short (1-5 words) and descriptive of the goal');
          break;

        case 'note':
          if (ref.noteId) {
            lines.push('');
            lines.push(`Note ID: ${ref.noteId}`);
            lines.push('');
            lines.push('**IMPORTANT: Use MCP tools to read the note:**');
            lines.push(`- Read the note: read_note_workspace-mcp(noteId="${ref.noteId}")`);
            lines.push('- The note contains context relevant to your task');
          }
          break;
      }
    });
  }

  return lines.join('\n');
}

/**
 * Convert context references to Amelia's currentContext format
 *
 * Takes our ContextReference[] and converts to the format expected
 * by auggie-chat-service's currentContext parameter.
 *
 * Currently takes the first file/selection reference.
 * Future: Extend currentContext to support multiple references.
 *
 * @param references - Context references
 * @returns currentContext object or undefined
 */
export function convertToCurrentContext(references: ContextReference[]):
  | {
      type: 'file' | 'note' | 'spec';
      path?: string;
      title?: string;
      noteId?: string;
    }
  | undefined {
  // Find first file reference
  const fileRef = references.find((ref) => ref.type === 'file');
  if (fileRef && fileRef.filePath) {
    return {
      type: 'file',
      path: fileRef.filePath,
    };
  }

  // Find first selection reference
  const selectionRef = references.find((ref) => ref.type === 'selection');
  if (selectionRef && selectionRef.surroundingContext?.filePath) {
    return {
      type: 'file',
      path: selectionRef.surroundingContext.filePath,
    };
  }

  // Find first task reference (treat as note)
  const taskRef = references.find((ref) => ref.type === 'task');
  if (taskRef) {
    return {
      type: 'note',
      title: taskRef.taskText,
    };
  }

  // Find spec reference
  const specRef = references.find((ref) => ref.type === 'spec');
  if (specRef) {
    return {
      type: 'spec',
    };
  }

  return undefined;
}
