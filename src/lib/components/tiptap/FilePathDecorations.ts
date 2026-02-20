/**
 * File Path Decorations Extension
 *
 * Adds the 'is-file-path' class to inline code elements that contain file paths.
 * This is done via ProseMirror decorations so the class persists through TipTap renders.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { extractFilePath } from '$lib/utils/file-path-detector';

export const filePathDecorationsKey = new PluginKey('filePathDecorations');

export interface FilePathDecorationOptions {
  onFilePathClick?: (filePath: string, event: MouseEvent) => void;
}

/**
 * Find all inline code nodes and create decorations for those containing file paths
 */
function createFilePathDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  // Walk through all nodes in the document
  doc.descendants((node, pos) => {
    // Check if this is a code mark on a text node
    if (node.isText && node.marks.some((mark) => mark.type.name === 'code')) {
      const text = node.text?.trim() || '';
      const filePath = extractFilePath(text);

      if (filePath) {
        // Create an inline decoration that adds the is-file-path class
        const decoration = Decoration.inline(
          pos,
          pos + node.nodeSize,
          {
            class: 'is-file-path',
            'data-file-path': filePath,
          },
          {
            inclusiveStart: true,
            inclusiveEnd: true,
          },
        );
        decorations.push(decoration);
      }
    }
    return true; // Continue traversing
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * Create the file path decorations plugin
 */
export function createFilePathDecorationsPlugin(options: FilePathDecorationOptions = {}): Plugin {
  return new Plugin({
    key: filePathDecorationsKey,

    state: {
      init(_, state) {
        return createFilePathDecorations(state.doc);
      },

      apply(tr, decorations, oldState, newState) {
        // If the document changed, recreate decorations
        if (tr.docChanged) {
          return createFilePathDecorations(newState.doc);
        }
        // Otherwise, map existing decorations through the transaction
        return decorations.map(tr.mapping, newState.doc);
      },
    },

    props: {
      decorations(state) {
        return this.getState(state);
      },

      // Handle clicks on file path elements
      handleClick(view, pos, event) {
        if (!options.onFilePathClick) {
          return false;
        }

        const target = event.target as HTMLElement;

        // Only handle clicks directly on or inside file path elements
        // Using matches() ensures the target is the element itself or a descendant
        if (!target.matches('[data-file-path], [data-file-path] *, code:has([data-file-path]), code:has([data-file-path]) *')) {
          return false;
        }

        // Find the file path element
        const filePathElement = target.closest('[data-file-path]') || target.querySelector('[data-file-path]');
        if (filePathElement) {
          const filePath = filePathElement.getAttribute('data-file-path');
          if (filePath) {
            options.onFilePathClick(filePath, event);
            return true;
          }
        }

        return false;
      },
    },
  });
}

/**
 * TipTap Extension that wraps the file path decorations plugin
 */
export const FilePathDecorations = Extension.create<FilePathDecorationOptions>({
  name: 'filePathDecorations',

  addOptions() {
    return {
      onFilePathClick: undefined,
    };
  },

  addProseMirrorPlugins() {
    return [
      createFilePathDecorationsPlugin({
        onFilePathClick: this.options.onFilePathClick,
      }),
    ];
  },
});

export default FilePathDecorations;
