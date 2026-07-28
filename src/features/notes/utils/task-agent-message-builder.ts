import type { Note } from '$shared/types';
import { noteLink } from '$shared/constants/intent-links';

/**
 * Build the initial content for a Task Note created from a checklist item.
 * This structure aligns with the task-loop agent instruction expectations.
 * (i18n-ignore rationale: agent-directed note/message content, kept in English)
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
    '## Initial Prompt', // i18n-ignore (agent-directed content)
    '',
    taskText,
    '',
    '## Hypothesized Acceptance Criteria', // i18n-ignore (agent-directed content)
    '',
    '(to be filled by agent)',
    '',
    '## References',
    '',
  ];

  // Add reference to parent note if provided
  if (parentNoteId) {
    const linkText = parentNoteTitle || 'parent note';
    // i18n-ignore (agent-directed content)
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
    'You have a linked note that serves as your workspace for this task.', // i18n-ignore (agent-directed content)
    `- **Note ID:** ${note.id}`, // i18n-ignore (agent-directed content)
    `- **Title:** ${note.title}`,
    `- **Status:** ${task?.status || 'not_started'}`,
    note.parentId ? `- **Parent Task:** ${note.parentId}` : '', // i18n-ignore (agent-directed content)
    '',
    `Use the \`workspace_api\` tool: \`ws.note.read("${note.id}")\` to read it.`, // i18n-ignore (agent-directed content)
    'Update it with your progress, findings, and deliverables.', // i18n-ignore (agent-directed content)
    '---',
    '',
  ].filter(Boolean);

  // i18n-ignore (agent-directed content)
  parts.push('**Task content from your note:**', '', note.content || '(no content)', '');

  if (userInstruction) {
    // i18n-ignore (agent-directed content)
    parts.push('**Additional instructions:**', '', userInstruction, '');
  }

  parts.push(
    '**First steps:**', // i18n-ignore (agent-directed content)
    '1. Read your linked note for full context', // i18n-ignore (agent-directed content)
    '2. Review acceptance criteria and any subtasks', // i18n-ignore (agent-directed content)
    `3. Update status to "in_progress": call ws.task.updateNoteStatus("${note.id}", "in_progress") via the workspace_api tool`, // i18n-ignore (agent-directed content)
    '4. Begin work and update your note with progress', // i18n-ignore (agent-directed content)
    '',
    `When complete, use ws.task.updateNoteStatus("${note.id}", "complete").`, // i18n-ignore (agent-directed content)
  );

  return parts.join('\n');
}
