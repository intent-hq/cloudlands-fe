import { Editor } from '@tiptap/core';

export type Heading = {
  id: string;
  text: string;
  level: number;
  pos: number;
};

export type TaskInfo = {
  position: number;
  text: string;
  checked: boolean;
  status: 'todo' | 'in-progress' | 'done';
  delegatedAgentId: string | null;
  linkedTaskNoteId: string | null;
};

export type Section = {
  heading: Heading;
  tasks: TaskInfo[];
  incompleteTasks: TaskInfo[];
  hasIncompleteTasks: boolean;
};

export const getHeadingsFromEditor = (editor: Editor) => {
  const headings: Heading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent;
      const level = node.attrs.level;
      const id = `heading-${headings.length + 1}`;
      headings.push({ id, text, level, pos });
    }
    return true;
  });
  return headings;
};

export const scrollToHeading = (editor: Editor, heading: Heading) => {
  editor.commands.smoothScrollToPos(heading.pos, {
    offset: 80,
    block: 'start',
  });
};

/**
 * Get sections from the editor with their associated tasks.
 * A section is defined as a heading and all content until the next heading of same or higher level.
 */
export const getSectionsWithTasks = (editor: Editor): Section[] => {
  const headings = getHeadingsFromEditor(editor);
  const sections: Section[] = [];

  // Collect all task items
  const allTasks: TaskInfo[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem') {
      const status = node.attrs.status || 'todo';
      const checked = node.attrs.checked === true || status === 'done';
      const delegatedAgentId = node.attrs.delegatedAgentId || null;

      // Check if this is a linked task by looking for the link content
      let linkedTaskNoteId: string | null = null;
      node.descendants((child) => {
        if (child.type.name === 'link') {
          const href = child.attrs.href || '';
          const match = href.match(/intent:\/\/local\/task\/([^\/]+)/);
          if (match) {
            linkedTaskNoteId = match[1];
          }
        }
      });

      allTasks.push({
        position: pos,
        text: node.textContent.trim(),
        checked,
        status,
        delegatedAgentId,
        linkedTaskNoteId,
      });
    }
    return true;
  });

  // For each heading, find tasks that belong to its section
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const nextHeading = headings[i + 1];

    // Section ends at next same-level-or-higher heading, or end of document
    const sectionEndPos = nextHeading
      ? (headings.slice(i + 1).find((h) => h.level <= heading.level)?.pos ?? Infinity)
      : Infinity;

    // Find tasks within this section's range
    const sectionTasks = allTasks.filter(
      (task) => task.position > heading.pos && task.position < sectionEndPos,
    );

    // Incomplete tasks are those not checked, not done status, and not already delegated or linked
    const incompleteTasks = sectionTasks.filter(
      (task) =>
        !task.checked && task.status !== 'done' && !task.delegatedAgentId && !task.linkedTaskNoteId,
    );

    sections.push({
      heading,
      tasks: sectionTasks,
      incompleteTasks,
      hasIncompleteTasks: incompleteTasks.length > 0,
    });
  }

  return sections;
};
