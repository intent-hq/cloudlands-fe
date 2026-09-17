/**
 * Remote Cursor Decorations Plugin
 *
 * Renders other viewers' carets (a widget with the caret bar and a name tag)
 * and selections (an inline highlight) as decorations, so they never touch
 * the document. Positions are document positions; the plugin re-anchors them
 * through every local edit with `DecorationSet.map(tr.mapping)` and rebuilds
 * only when a transaction carries a new cursor set via `setRemoteCursors`.
 */

import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface RemoteCursor {
  principalId: string;
  /** Name shown on the caret tag. */
  label: string;
  avatarUrl: string | null;
  /** CSS colour shared by the caret, the tag and the selection highlight. */
  color: string;
  anchor: number;
  head: number;
}

interface RemoteCursorsMeta {
  cursors: RemoteCursor[];
}

export const remoteCursorsPluginKey = new PluginKey<DecorationSet>('remoteCursors');

/** Stable per-principal hue: the same person gets the same colour everywhere. */
export function remoteCursorColor(principalId: string): string {
  let hash = 0;
  for (let i = 0; i < principalId.length; i += 1) {
    hash = (hash * 31 + principalId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 45%)`;
}

function clampPos(doc: ProseMirrorNode, pos: number): number {
  return Math.max(0, Math.min(pos, doc.content.size));
}

let widgetSequence = 0;

function caretWidget(cursor: RemoteCursor): HTMLElement {
  const root = document.createElement('span');
  root.className = 'remote-cursor';
  root.style.setProperty('--remote-cursor-color', cursor.color);
  // Anchor name the bar and the tag position themselves against (see
  // `.remote-cursor` in tiptap-editor.css); unique per widget so two carets
  // at the same position never share an anchor.
  widgetSequence += 1;
  root.style.setProperty('--remote-cursor-anchor', `--remote-cursor-${widgetSequence}`);
  root.dataset.principalId = cursor.principalId;
  root.setAttribute('aria-hidden', 'true');
  root.contentEditable = 'false';

  const bar = document.createElement('span');
  bar.className = 'remote-cursor__bar';
  root.appendChild(bar);

  const tag = document.createElement('span');
  tag.className = 'remote-cursor__tag';
  if (cursor.avatarUrl) {
    const img = document.createElement('img');
    img.className = 'remote-cursor__avatar';
    img.src = cursor.avatarUrl;
    img.alt = '';
    img.loading = 'lazy';
    tag.appendChild(img);
  }
  const name = document.createElement('span');
  name.className = 'remote-cursor__name';
  name.textContent = cursor.label;
  tag.appendChild(name);
  root.appendChild(tag);
  return root;
}

function buildDecorations(doc: ProseMirrorNode, cursors: RemoteCursor[]): DecorationSet {
  const decorations: Decoration[] = [];
  for (const cursor of cursors) {
    const head = clampPos(doc, cursor.head);
    const anchor = clampPos(doc, cursor.anchor);
    if (anchor !== head) {
      decorations.push(
        Decoration.inline(
          Math.min(anchor, head),
          Math.max(anchor, head),
          {
            class: 'remote-selection',
            style: `--remote-cursor-color: ${cursor.color}`,
            'data-principal-id': cursor.principalId,
          },
          { principalId: cursor.principalId },
        ),
      );
    }
    decorations.push(
      Decoration.widget(head, () => caretWidget(cursor), {
        key: `remote-cursor:${cursor.principalId}:${cursor.label}:${cursor.avatarUrl ?? ''}`,
        side: 1,
        ignoreSelection: true,
        principalId: cursor.principalId,
      }),
    );
  }
  return DecorationSet.create(doc, decorations);
}

export function createRemoteCursorDecorationsPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: remoteCursorsPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr: Transaction, decorations: DecorationSet, _oldState, newState) {
        const meta = tr.getMeta(remoteCursorsPluginKey) as RemoteCursorsMeta | undefined;
        if (meta) return buildDecorations(newState.doc, meta.cursors);
        if (tr.docChanged) return decorations.map(tr.mapping, newState.doc);
        return decorations;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

/** Replace the rendered remote cursors; an empty list clears them. */
export function setRemoteCursors(view: EditorView, cursors: RemoteCursor[]): void {
  if (!remoteCursorsPluginKey.getState(view.state)) return;
  const meta: RemoteCursorsMeta = { cursors };
  view.dispatch(view.state.tr.setMeta(remoteCursorsPluginKey, meta).setMeta('addToHistory', false));
}
