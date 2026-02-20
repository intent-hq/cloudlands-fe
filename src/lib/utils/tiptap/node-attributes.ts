/**
 * Utilities for updating TipTap node attributes
 *
 * Provides a clean API for updating node attributes via ProseMirror transactions,
 * abstracting away the verbose transaction code.
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('NodeAttributes');

/**
 * Update node attributes via ProseMirror transaction
 *
 * This is a convenience wrapper around the verbose ProseMirror transaction API.
 * It handles position validation, attribute merging, and focus management.
 *
 * @param editor - TipTap editor instance
 * @param getPos - Function to get current node position
 * @param currentNode - Current node (for merging attrs)
 * @param newAttrs - New attributes to set
 * @param options - Optional configuration
 * @returns Whether the update succeeded
 *
 * @example
 * ```typescript
 * // Simple update
 * updateNodeAttributes(editor, getPos, currentNode, {
 *   checked: true,
 *   status: "done"
 * });
 *
 * // Update without focus
 * updateNodeAttributes(editor, getPos, currentNode, {
 *   checked: true
 * }, { focus: false });
 *
 * // Replace all attributes (no merge)
 * updateNodeAttributes(editor, getPos, currentNode, {
 *   checked: true,
 *   status: "done"
 * }, { merge: false });
 * ```
 */
export function updateNodeAttributes(
  editor: Editor,
  getPos: () => number | undefined,
  currentNode: ProseMirrorNode,
  newAttrs: Record<string, any>,
  options: {
    /** Whether to focus the editor after update (default: true) */
    focus?: boolean;
    /** Whether to merge with existing attributes (default: true) */
    merge?: boolean;
  } = {},
): boolean {
  const { focus = true, merge = true } = options;
  const pos = getPos();

  if (typeof pos !== 'number') {
    logger.warn('Invalid position returned from getPos()');
    return false;
  }

  const chain = editor.chain();
  if (focus) chain.focus();

  return chain
    .command(({ tr }) => {
      const attrs = merge ? { ...currentNode.attrs, ...newAttrs } : newAttrs;
      tr.setNodeMarkup(pos, undefined, attrs);
      return true;
    })
    .run();
}
