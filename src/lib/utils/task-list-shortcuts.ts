import { Extension } from '@tiptap/core';
import { wrappingInputRule } from '@tiptap/core';

export const TaskListShortcuts = Extension.create({
  name: 'taskListShortcuts',

  addInputRules() {
    return [
      // Convert [/] into an in-progress task list item
      wrappingInputRule({
        find: /^\s*(\[\/\])\s$/,
        type: this.editor.schema.nodes.taskItem,
        getAttributes: () => ({
          checked: false,
          status: 'in-progress',
        }),
      }),
      // Convert [] into a task list item
      wrappingInputRule({
        find: /^\s*(\[([ x])\])\s$/,
        type: this.editor.schema.nodes.taskItem,
        getAttributes: (match) => ({
          checked: match[2] === 'x',
          status: match[2] === 'x' ? 'done' : 'todo',
        }),
      }),
      // Alternative pattern for just [] without space inside
      wrappingInputRule({
        find: /^\s*(\[\])\s$/,
        type: this.editor.schema.nodes.taskItem,
        getAttributes: () => ({
          checked: false,
          status: 'todo',
        }),
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Toggle task list with Cmd/Ctrl + Shift + 9
      'Mod-Shift-9': () => this.editor.commands.toggleTaskList(),
    };
  },
});
