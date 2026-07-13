import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TaskItem } from '@tiptap/extension-task-item';
import { SvelteNodeViewRenderer } from '$lib/utils/tiptap/svelte-node-view';
import TaskItemNodeView from './TaskItemNodeView.svelte';
import { createLogger } from '$lib/utils/client-logger';
import { taskNoteUrl } from '$shared/constants/intent-links';

const logger = createLogger('CustomTaskItem');

export interface TaskMenuClickDetail {
  node: any; // JSON representation of the node
  position: number;
  checked: boolean;
  text: string;
  event: MouseEvent;
  anchorName?: string; // CSS anchor name for positioning
}

export interface CustomTaskItemOptions {
  nested: boolean;
  HTMLAttributes: Record<string, any>;
  onReadOnlyChecked?: (node: ProseMirrorNode, checked: boolean) => boolean;
  taskListTypeName?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    taskItem: {
      /**
       * Toggle a task item's checked state
       */
      toggleTaskItem: () => ReturnType;
      /**
       * Set the delegated agent ID for a task item
       */
      setTaskAgentId: (position: number, agentId: string | null) => ReturnType;
      /**
       * Convert a task item to a linked task by replacing its content
       * with a link to a Task Note.
       *
       * Transforms: `- [ ] Some task text`
       * Into:       `- [ ] [delegated](intent://local/task/{noteId})`
       */
      convertToLinkedTask: (position: number, noteId: string) => ReturnType;
      /**
       * Convert a task item to a linked task by finding it via its delegatedAgentId.
       * More robust than convertToLinkedTask when the document may have changed.
       *
       * Transforms: `- [ ] Some task text`
       * Into:       `- [ ] [delegated](intent://local/task/{noteId})`
       */
      convertToLinkedTaskByAgentId: (agentId: string, noteId: string) => ReturnType;
    };
  }
}

/**
 * Enhanced Custom TaskItem extension for Tiptap
 *
 * Uses the new SvelteNodeViewRenderer for proper Svelte 5 reactivity.
 * Features:
 * - Custom node view with Svelte component (TaskItemNodeView)
 * - Three-state checkbox (todo → in-progress → done)
 * - Agent delegation support with TaskAgentStatus integration
 * - Action buttons for task delegation and splitting
 */
export const CustomTaskItem = TaskItem.extend<CustomTaskItemOptions>({
  name: 'taskItem',

  addOptions() {
    return {
      nested: true,
      HTMLAttributes: {
        class: 'custom-task-item',
      },
      onReadOnlyChecked: undefined,
      taskListTypeName: 'taskList',
      ...this.parent?.(),
    } as CustomTaskItemOptions;
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      status: {
        default: 'todo',
        parseHTML: (element: any) => element.getAttribute('data-status') || 'todo',
        renderHTML: (attributes: any) => ({
          'data-status': attributes.status,
        }),
      },
      delegatedAgentId: {
        default: null,
        parseHTML: (element: any) => element.getAttribute('data-delegated-agent-id') || null,
        renderHTML: (attributes: any) =>
          attributes.delegatedAgentId
            ? { 'data-delegated-agent-id': attributes.delegatedAgentId }
            : {},
      },
    };
  },

  // Override parseHTML to specify contentElement - this tells ProseMirror
  // where to find the editable content within the task item HTML
  parseHTML() {
    return [
      {
        tag: `li[data-type="${this.name}"]`,
        priority: 51,
        // Content is inside a <div> wrapper (after the <label> checkbox)
        contentElement: 'div',
      },
    ];
  },

  addNodeView() {
    // Don't pass `as: 'li'` here - the component's NodeViewWrapper handles the element type
    // Passing it here would create nested <li><li>...</li></li> elements
    return SvelteNodeViewRenderer(TaskItemNodeView);
  },

  addCommands() {
    return {
      ...this.parent?.(),
      toggleTaskItem:
        () =>
        ({ commands }) =>
          commands.toggleList(this.name, this.options.taskListTypeName ?? 'taskList'),
      setTaskAgentId:
        (position: number, agentId: string | null) =>
        ({ tr, state }) => {
          const node = state.doc.nodeAt(position);
          if (!node || node.type.name !== 'taskItem') {
            return false;
          }

          tr.setNodeMarkup(position, undefined, {
            ...node.attrs,
            delegatedAgentId: agentId,
          });

          return true;
        },
      /**
       * Convert a task item to a linked task.
       *
       * Replaces the task item's content with: [delegated](intent://local/task/{noteId})
       *
       * The markdown serializer (processHTMLToMarkdown) will convert this to:
       *   - [ ] [delegated](intent://local/task/{noteId})
       *
       * @param position - The position of the taskItem node in the document
       * @param noteId - The ID of the Task Note to link to
       */
      convertToLinkedTask:
        (position: number, noteId: string) =>
        ({ tr, state }) => {
          const node = state.doc.nodeAt(position);
          if (!node || node.type.name !== 'taskItem') {
            logger.warn('[convertToLinkedTask] Node at position is not a taskItem', {
              position,
              nodeType: node?.type.name,
            });
            return false;
          }

          // Create the link URL using shared constants
          const href = taskNoteUrl(noteId);

          // Get the link mark type from the schema
          const linkMarkType = state.schema.marks.link;
          if (!linkMarkType) {
            logger.error('[convertToLinkedTask] Link mark type not found in schema');
            return false;
          }

          // Create a text node with a link mark
          const linkMark = linkMarkType.create({ href });
          const textNode = state.schema.text('delegated', [linkMark]);

          // Create a paragraph containing the linked text
          const paragraphType = state.schema.nodes.paragraph;
          if (!paragraphType) {
            logger.error('[convertToLinkedTask] Paragraph node type not found in schema');
            return false;
          }
          const newParagraph = paragraphType.create(null, textNode);

          // Calculate the content range to replace
          // taskItem structure: taskItem > paragraph > text
          // Position is the taskItem node position
          // +1 gets us inside the taskItem (start of content)
          const contentStart = position + 1;
          const contentEnd = position + node.nodeSize - 1; // -1 to stay inside the taskItem

          logger.info('[convertToLinkedTask] Replacing task item content', {
            position,
            contentStart,
            contentEnd,
            noteId,
            href,
          });

          // Replace the content inside the taskItem with the new paragraph
          tr.replaceWith(contentStart, contentEnd, newParagraph);

          return true;
        },
      /**
       * Convert a task item to a linked task by finding it via its delegatedAgentId.
       * This is more robust than convertToLinkedTask when multiple tasks are being
       * delegated rapidly, as it doesn't rely on positions which can shift.
       */
      convertToLinkedTaskByAgentId:
        (agentId: string, noteId: string) =>
        ({ tr, state }) => {
          // Find the task item with the matching delegatedAgentId
          let foundPos = -1;
          let foundNodeSize = 0;

          state.doc.descendants((node, pos) => {
            if (foundPos >= 0) return false; // Already found, stop traversing
            if (node.type.name === 'taskItem' && node.attrs.delegatedAgentId === agentId) {
              foundPos = pos;
              foundNodeSize = node.nodeSize;
              return false; // Stop traversing
            }
            return true; // Continue traversing
          });

          if (foundPos < 0) {
            logger.warn('[convertToLinkedTaskByAgentId] Task item with agentId not found', {
              agentId,
              noteId,
            });
            return false;
          }

          // Create the link URL using shared constants
          const href = taskNoteUrl(noteId);

          // Get the link mark type from the schema
          const linkMarkType = state.schema.marks.link;
          if (!linkMarkType) {
            logger.error('[convertToLinkedTaskByAgentId] Link mark type not found in schema');
            return false;
          }

          // Create a text node with a link mark
          const linkMark = linkMarkType.create({ href });
          const textNode = state.schema.text('delegated', [linkMark]);

          // Create a paragraph containing the linked text
          const paragraphType = state.schema.nodes.paragraph;
          if (!paragraphType) {
            logger.error('[convertToLinkedTaskByAgentId] Paragraph node type not found');
            return false;
          }
          const newParagraph = paragraphType.create(null, textNode);

          // Calculate the content range to replace
          const contentStart = foundPos + 1;
          const contentEnd = foundPos + foundNodeSize - 1;

          logger.info('[convertToLinkedTaskByAgentId] Replacing task item content', {
            foundPos,
            contentStart,
            contentEnd,
            agentId,
            noteId,
            href,
          });

          // Replace the content inside the taskItem with the new paragraph
          tr.replaceWith(contentStart, contentEnd, newParagraph);

          return true;
        },
    };
  },

  // Add keyboard shortcuts for better UX
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      'Mod-Enter': () => {
        // Toggle current task item by finding it in the selection path
        const { state } = this.editor;
        const { $from } = state.selection;

        // Traverse up the selection path to find a task item node
        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth);
          if (node.type.name === this.name) {
            return this.editor.commands.updateAttributes(this.name, {
              checked: !node.attrs.checked,
            });
          }
        }
        return false;
      },
    };
  },
});
