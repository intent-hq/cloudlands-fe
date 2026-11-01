import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { formatInteger } from '$lib/i18n/format';
import type { DockInsertionPart, EditorScreenReference } from '$shared/dock-evidence';

export interface ScreenInterim {
  parts: readonly DockInsertionPart[];
  references: readonly EditorScreenReference[];
  anchor: number;
  ariaLabel: string;
}

export const screenInterimKey = new PluginKey<ScreenInterim | null>('screenInterim');

/** Interim speech is a decoration: it never enters the document, undo stack or wire text. */
export const ScreenInterimExtension = Extension.create({
  name: 'screenInterim',
  addProseMirrorPlugins() {
    return [
      new Plugin<ScreenInterim | null>({
        key: screenInterimKey,
        state: {
          init: () => null,
          apply(transaction, previous) {
            const next = transaction.getMeta(screenInterimKey) as ScreenInterim | null | undefined;
            if (next !== undefined) return next;
            return previous
              ? { ...previous, anchor: transaction.mapping.map(previous.anchor, 1) }
              : null;
          },
        },
        props: {
          decorations(state) {
            const interim = screenInterimKey.getState(state);
            if (!interim?.parts.length) return DecorationSet.empty;
            const references = new Map(
              interim.references.map((reference) => [reference.id, reference]),
            );
            return DecorationSet.create(state.doc, [
              Decoration.widget(
                Math.max(0, Math.min(interim.anchor, state.doc.content.size)),
                () => {
                  const root = document.createElement('span');
                  root.className = 'screen-interim';
                  root.contentEditable = 'false';
                  root.setAttribute('role', 'status');
                  root.setAttribute('aria-label', interim.ariaLabel);
                  root.setAttribute('data-screen-interim', '');
                  for (const part of interim.parts) {
                    if (part.kind === 'text') root.append(document.createTextNode(part.text));
                    else {
                      const reference = references.get(part.markId);
                      if (!reference) continue;
                      const badge = document.createElement('span');
                      badge.className = 'screen-reference-chip';
                      badge.textContent = reference.kind
                        ? reference.label
                        : formatInteger(reference.number);
                      if (reference.kind) badge.dataset.referenceKind = reference.kind;
                      badge.setAttribute('aria-label', reference.label);
                      root.append(badge);
                    }
                  }
                  root.append(document.createTextNode('…'));
                  return root;
                },
                {
                  key: JSON.stringify([interim.parts, interim.references]),
                  // Drawn before the caret: the caret sits at the end of the live words.
                  side: -1,
                  ignoreSelection: true,
                },
              ),
            ]);
          },
        },
      }),
    ];
  },
});
