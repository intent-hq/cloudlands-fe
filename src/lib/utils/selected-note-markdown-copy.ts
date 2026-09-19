import { DOMSerializer, Fragment, type Node, type Schema, type Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { processHTMLToMarkdown } from './markdown-processor';

function isAllowedAtTopLevel(node: Node, schema: Schema): boolean {
  return schema.topNodeType.contentMatch.matchType(node.type) !== null;
}

/**
 * A selection inside a single container (table cell, list item, blockquote) yields a
 * slice whose fragment still carries the open ancestor nodes around the selected text.
 * Serializing those wrappers would emit table/list/quote syntax the user never selected,
 * so descend through single-child wrappers until the first textblock or the first node
 * with more than one child. A wrapper that can stand at the document level (list,
 * blockquote) is only unwrapped while it is open and single-branch, so a selection that
 * spans sibling list items or quote paragraphs keeps its list type / quote marker. A
 * wrapper that cannot stand alone (table row or cell, list item) is unwrapped regardless
 * of how many blocks it holds, because it has no standalone meaning.
 */
function unwrapOpenWrappers(slice: Slice, schema: Schema): Fragment {
  let fragment = slice.content;
  let openStart = slice.openStart;
  let openEnd = slice.openEnd;

  while (fragment.childCount === 1) {
    const child = fragment.firstChild;
    if (!child || child.isTextblock || child.isLeaf) {
      break;
    }
    const isOpen = openStart > 0 && openEnd > 0;
    if (isAllowedAtTopLevel(child, schema) && (!isOpen || child.childCount !== 1)) {
      break;
    }
    fragment = child.content;
    openStart = Math.max(0, openStart - 1);
    openEnd = Math.max(0, openEnd - 1);
  }

  return fragment;
}

/**
 * Cell selections (and a stopped unwrap) can leave nodes such as table rows or cells
 * that are not valid at the document level and have no standalone HTML meaning. Wrap
 * them in the structural parents the schema requires, mirroring what ProseMirror's
 * clipboard serializer does.
 */
function wrapForTopLevel(fragment: Fragment, schema: Schema): Fragment {
  const first = fragment.firstChild;
  if (!first || isAllowedAtTopLevel(first, schema)) {
    return fragment;
  }

  const wrapping = schema.topNodeType.contentMatch.findWrapping(first.type);
  if (!wrapping) {
    return fragment;
  }

  return wrapping.reduceRight((inner, type) => Fragment.from(type.create(null, inner)), fragment);
}

export function serializeSelectionToMarkdown(
  view: EditorView,
  workspaceId?: string,
): string | null {
  const { state } = view;

  if (state.selection.empty || typeof document === 'undefined') {
    return null;
  }

  const slice = state.selection.content();
  if (slice.content.size === 0) {
    return null;
  }

  const fragment = wrapForTopLevel(unwrapOpenWrappers(slice, state.schema), state.schema);

  const container = document.createElement('div');
  const serializer = DOMSerializer.fromSchema(state.schema);
  container.appendChild(serializer.serializeFragment(fragment, { document }));

  const html = container.innerHTML;
  if (!html.trim()) {
    return null;
  }

  const markdown = processHTMLToMarkdown(html, { preserveAnchors: false, workspaceId }).trim();
  return markdown || null;
}

export function handleNoteEditorCopyAsMarkdown(
  view: EditorView,
  event: ClipboardEvent,
  workspaceId?: string,
): boolean {
  try {
    const markdown = serializeSelectionToMarkdown(view, workspaceId);
    if (!markdown || !event.clipboardData) {
      return false;
    }

    event.clipboardData.setData('text/plain', markdown);
    event.preventDefault();
    return true;
  } catch {
    return false;
  }
}
