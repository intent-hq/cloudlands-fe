import { Node, mergeAttributes } from '@tiptap/core';

export interface SkillCommandAttributes {
  name: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    skillCommand: {
      insertSkillCommand: (attrs: SkillCommandAttributes) => ReturnType;
    };
  }
}

/** Atomic inline representation of a selected slash-skill command. */
export const SkillCommand = Node.create({
  name: 'skillCommand',

  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-skill-name') || '',
        renderHTML: (attributes) => ({ 'data-skill-name': attributes.name }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="skill-command"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const command = `/${node.attrs.name || ''}`;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'skill-command',
        class: 'skill-command-chip',
        role: 'code',
        'aria-label': command,
        contenteditable: 'false',
      }),
      command,
    ];
  },

  renderText({ node }) {
    return `/${node.attrs.name || ''}`;
  },

  addCommands() {
    return {
      insertSkillCommand:
        (attrs: SkillCommandAttributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { selection, doc } = this.editor.state;
        if (!selection.empty) return false;

        const { $from } = selection;
        const direct = $from.nodeBefore;
        if (direct?.type.name === this.name) {
          return this.editor.commands.deleteRange({
            from: $from.pos - direct.nodeSize,
            to: $from.pos,
          });
        }

        if (direct?.isText && direct.text?.endsWith(' ')) {
          const beforeSpace = doc.resolve($from.pos - 1).nodeBefore;
          if (beforeSpace?.type.name === this.name) {
            return this.editor.commands.deleteRange({
              from: $from.pos - 1 - beforeSpace.nodeSize,
              to: $from.pos,
            });
          }
        }
        return false;
      },
      Delete: () => {
        const { selection, doc } = this.editor.state;
        if (!selection.empty) return false;

        const { $from } = selection;
        const direct = $from.nodeAfter;
        if (direct?.type.name !== this.name) return false;

        const afterCommand = doc.resolve($from.pos + direct.nodeSize).nodeAfter;
        const trailingSpace = afterCommand?.isText && afterCommand.text?.startsWith(' ') ? 1 : 0;
        return this.editor.commands.deleteRange({
          from: $from.pos,
          to: $from.pos + direct.nodeSize + trailingSpace,
        });
      },
    };
  },
});
