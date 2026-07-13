import type { Note } from '$shared/types';
import { noteLink } from '$shared/constants/intent-links';

/**
 * Build the initial content for a Task Note created from a checklist item.
 * This structure aligns with the task-loop agent instruction expectations.
 *
 * @param taskText - The text from the original checklist item
 * @param parentNoteId - Optional ID of the note containing the original checklist
 * @param parentNoteTitle - Optional title of the parent note
 */
export function buildTaskNoteContent(
  taskText: string,
  parentNoteId?: string,
  parentNoteTitle?: string,
): string {
  const parts = [
    '## Initial Prompt',
    '',
    taskText,
    '',
    '## Hypothesized Acceptance Criteria',
    '',
    '(to be filled by agent)',
    '',
    '## References',
    '',
  ];

  // Add reference to parent note if provided
  if (parentNoteId) {
    const linkText = parentNoteTitle || 'parent note';
    parts.push(`- Originated from checklist in ${noteLink(linkText, parentNoteId)}`);
  } else {
    parts.push('(none yet)');
  }

  parts.push('', '## Learnings', '', '(empty)', '', '## Changes', '', '(empty)');

  return parts.join('\n');
}

/**
 * Build initial message for an agent assigned to a task note.
 * This message provides context about the task and guides the agent on first steps.
 *
 * Note: Task dependencies are now represented by parent/child hierarchy (parentId).
 * Child notes are subtasks that must complete before the parent is ready.
 */
export function buildTaskAgentInitialMessage(note: Note, userInstruction?: string): string {
  const task = note.metadata?.task;

  const parts = [
    '---',
    '**YOUR LINKED NOTE**',
    '',
    'You have a linked note that serves as your workspace for this task.',
    `- **Note ID:** ${note.id}`,
    `- **Title:** ${note.title}`,
    `- **Status:** ${task?.status || 'not_started'}`,
    note.parentId ? `- **Parent Task:** ${note.parentId}` : '',
    '',
    `Use the \`workspace_api\` tool: \`ws.note.read("${note.id}")\` to read it.`,
    'Update it with your progress, findings, and deliverables.',
    '---',
    '',
  ].filter(Boolean);

  parts.push('**Task content from your note:**', '', note.content || '(no content)', '');

  if (userInstruction) {
    parts.push('**Additional instructions:**', '', userInstruction, '');
  }

  parts.push(
    '**First steps:**',
    '1. Read your linked note for full context',
    '2. Review acceptance criteria and any subtasks',
    `3. Update status to "in_progress": call ws.task.updateNoteStatus("${note.id}", "in_progress") via the workspace_api tool`,
    '4. Begin work and update your note with progress',
    '',
    `When complete, use ws.task.updateNoteStatus("${note.id}", "complete").`,
  );

  return parts.join('\n');
}
