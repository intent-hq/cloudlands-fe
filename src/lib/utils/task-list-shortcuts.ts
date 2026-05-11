import { Extension, InputRule, wrappingInputRule, type ExtendedRegExpMatchArray } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeType } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';

type TaskStatus = 'todo' | 'in-progress' | 'done';

interface TaskItemAttributes {
  checked: boolean;
  status: TaskStatus;
}

type TaskItemAttributesGetter = (match: ExtendedRegExpMatchArray) => TaskItemAttributes;

const inProgressTaskInputRegex = /^\s*(?:[-*]\s+)?(\[\/\])\s$/;
const checkboxTaskInputRegex = /^\s*(?:[-*]\s+)?(\[([ xX])\])\s$/;
const emptyTaskInputRegex = /^\s*(?:[-*]\s+)?(\[\])\s$/;

const getInProgressAttributes = (): TaskItemAttributes => ({
  checked: false,
  status: 'in-progress',
});

const getCheckboxAttributes = (match: ExtendedRegExpMatchArray): TaskItemAttributes => {
  const checked = match[2]?.toLowerCase() === 'x';

  return {
    checked,
    status: checked ? 'done' : 'todo',
  };
};

const getEmptyTaskAttributes = (): TaskItemAttributes => ({
  checked: false,
  status: 'todo',
});

function createBulletTaskInputRule(find: RegExp, getAttributes: TaskItemAttributesGetter) {
  return new InputRule({
    find,
    handler: ({ state, range, match }) => {
      const { bulletList, listItem, taskItem, taskList } = state.schema.nodes;

      if (!bulletList || !listItem || !taskItem || !taskList) {
        return null;
      }

      const $from = state.doc.resolve(range.from);
      let bulletListDepth = -1;

      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type === listItem && $from.node(depth - 1).type === bulletList) {
          bulletListDepth = depth - 1;
          break;
        }
      }

      if (bulletListDepth === -1) {
        return null;
      }

      const listItemIndex = $from.index(bulletListDepth);
      const bulletListPos = $from.before(bulletListDepth);
      const tr = state.tr.delete(range.from, range.to);
      const mappedBulletListPos = tr.mapping.map(bulletListPos);
      const currentBulletList = tr.doc.nodeAt(mappedBulletListPos);

      if (!currentBulletList || currentBulletList.type !== bulletList) {
        return null;
      }

      const beforeItems: ProseMirrorNode[] = [];
      const afterItems: ProseMirrorNode[] = [];
      const currentItem = currentBulletList.maybeChild(listItemIndex);

      currentBulletList.forEach((child, _offset, index) => {
        if (index < listItemIndex) {
          beforeItems.push(child);
        } else if (index > listItemIndex) {
          afterItems.push(child);
        }
      });

      if (!currentItem || currentItem.type !== listItem) {
        return null;
      }

      const replacementNodes: ProseMirrorNode[] = [];

      if (beforeItems.length) {
        replacementNodes.push(bulletList.create(currentBulletList.attrs, beforeItems));
      }

      const taskListInsertionPos =
        mappedBulletListPos + replacementNodes.reduce((pos, node) => pos + node.nodeSize, 0);
      replacementNodes.push(taskList.create(null, taskItem.create(getAttributes(match), currentItem.content)));

      if (afterItems.length) {
        replacementNodes.push(bulletList.create(currentBulletList.attrs, afterItems));
      }

      tr.replaceWith(
        mappedBulletListPos,
        mappedBulletListPos + currentBulletList.nodeSize,
        Fragment.fromArray(replacementNodes),
      );

      tr.setSelection(Selection.near(tr.doc.resolve(taskListInsertionPos + 2), 1));

      return undefined;
    },
  });
}

function createTaskInputRules(
  find: RegExp,
  getAttributes: TaskItemAttributesGetter,
  taskItemType: NodeType,
) {
  return [
    createBulletTaskInputRule(find, getAttributes),
    wrappingInputRule({
      find,
      type: taskItemType,
      getAttributes,
    }),
  ];
}

export const TaskListShortcuts = Extension.create({
  name: 'taskListShortcuts',

  addInputRules() {
    return [
      // Convert [/] or Markdown bullets like - [/] into an in-progress task item.
      ...createTaskInputRules(
        inProgressTaskInputRegex,
        getInProgressAttributes,
        this.editor.schema.nodes.taskItem,
      ),
      // Convert [ ], [x], or Markdown bullets like - [ ] / * [ ] into task items.
      ...createTaskInputRules(
        checkboxTaskInputRegex,
        getCheckboxAttributes,
        this.editor.schema.nodes.taskItem,
      ),
      // Alternative pattern for just [] without space inside.
      ...createTaskInputRules(emptyTaskInputRegex, getEmptyTaskAttributes, this.editor.schema.nodes.taskItem),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Toggle task list with Cmd/Ctrl + Shift + 9
      'Mod-Shift-9': () => this.editor.commands.toggleTaskList(),
    };
  },
});
