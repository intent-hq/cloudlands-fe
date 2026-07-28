/**
 * Code Block Copy Button Extension
 *
 * Adds a floating copy button to code blocks in the TipTap editor.
 * The button appears on hover and copies the code content to the clipboard.
 * Uses ProseMirror Decoration.widget so the buttons are managed by
 * ProseMirror's rendering lifecycle (no direct DOM mutation).
 */

import { Extension } from '@tiptap/core';
import {
  Plugin,
  PluginKey,
} from '@tiptap/pm/state';
import {
  Decoration,
  DecorationSet,
} from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { m } from '$shared/paraglide/messages.js';

const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 448 512" fill="currentColor"><path d="M384 336H192c-8.8 0-16-7.2-16-16V64c0-8.8 7.2-16 16-16l140.1 0L400 115.9V320c0 8.8-7.2 16-16 16zM192 384H384c35.3 0 64-28.7 64-64V115.9c0-12.7-5.1-24.9-14.1-33.9L366.1 14.1c-9-9-21.2-14.1-33.9-14.1H192c-35.3 0-64 28.7-64 64V320c0 35.3 28.7 64 64 64zM64 128c-35.3 0-64 28.7-64 64V448c0 35.3 28.7 64 64 64H256c35.3 0 64-28.7 64-64V416H272v32c0 8.8-7.2 16-16 16H64c-8.8 0-16-7.2-16-16V192c0-8.8 7.2-16 16-16h32V128H64z"/></svg>`;

const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 448 512" fill="currentColor"><path d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"/></svg>`;

/**
 * Creates a copy button DOM element. The text to copy is captured at
 * decoration-creation time from the ProseMirror node model, so it is
 * never read from the (potentially widget-polluted) DOM.
 */
function createCopyButton(textToCopy: string): HTMLElement {
  const btn = document.createElement('button');
  btn.contentEditable = 'false';
  btn.className = 'code-block-copy-btn';
  btn.type = 'button';
  btn.title = m.tiptap_codeBlock_copy_tooltip();
  btn.innerHTML = COPY_ICON;

  btn.addEventListener('mousedown', (e) => {
    // Prevent ProseMirror from handling this as a selection event
    e.preventDefault();
    e.stopPropagation();
  });

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    navigator.clipboard.writeText(textToCopy).then(() => {
      btn.innerHTML = CHECK_ICON;
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = COPY_ICON;
        btn.classList.remove('copied');
      }, 2000);
    });
  });

  return btn;
}

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') {
      const text = node.textContent;

      decorations.push(
        Decoration.widget(pos + 1, () => createCopyButton(text), {
          side: -1,
          key: `code-copy-${pos}`,
          // This widget is not selectable content
          ignoreSelection: true,
        }),
      );

      return false; // don't descend into code block children
    }
    return true;
  });

  return DecorationSet.create(doc, decorations);
}

export const codeBlockCopyButtonKey = new PluginKey('codeBlockCopyButton');

/**
 * TipTap Extension that adds copy buttons to code blocks
 */
export const CodeBlockCopyButton = Extension.create({
  name: 'codeBlockCopyButton',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeBlockCopyButtonKey,

        state: {
          init(_, state) {
            return buildDecorations(state.doc);
          },
          apply(tr, decorations, _oldState, newState) {
            if (tr.docChanged) {
              return buildDecorations(newState.doc);
            }
            return decorations.map(tr.mapping, newState.doc);
          },
        },

        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

export default CodeBlockCopyButton;
