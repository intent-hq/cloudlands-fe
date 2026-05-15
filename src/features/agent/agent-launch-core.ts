/**
 * Agent Launch Core Helpers
 *
 * Core helper functions for assembling workspace context for agent launches.
 */

import type { ContextReference } from './agent-context';

/**
 * Build workspace context from context references
 *
 * Creates a minimal context string with workspace path and file list.
 * This gets passed via STDIN to auggie.
 *
 * @param workspacePath - Path to workspace root
 * @param references - Context references (files, selections, etc.)
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
      "Spec: Available as a note with ID 'spec' (use ws.note.read with noteId='spec' to read, ws.note.add to add content, ws.note.edit to modify)",
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
