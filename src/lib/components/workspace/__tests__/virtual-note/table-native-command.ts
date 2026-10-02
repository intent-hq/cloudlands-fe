import type { CommandProps, Editor } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { CellSelection, tableEditing } from '@tiptap/pm/tables';
import { bytes } from './bounded-note-service';

export const tableCommands = [
  'addRowBefore',
  'addRowAfter',
  'deleteRow',
  'addColumnBefore',
  'addColumnAfter',
  'deleteColumn',
  'mergeCells',
  'splitCell',
  'toggleHeaderRow',
  'toggleHeaderColumn',
  'toggleHeaderCell',
  'mergeOrSplit',
] as const;
export type TableCommandName = (typeof tableCommands)[number];

/** External mock backing computation, never a mounted editor or renderer reply.
 * Invoke the locked native command, including Tiptap's cursor retention wrappers.
 * No EditorView, layout or full-table DOM is created here. */
export function applyNativeTableCommand(
  doc: PMNode,
  anchor: number,
  head: number,
  kind: 'text' | 'cell',
  name: TableCommandName,
  editor: Editor,
) {
  const state = EditorState.create({
    doc,
    schema: editor.schema,
    plugins: [tableEditing()],
    selection:
      kind === 'cell'
        ? CellSelection.create(doc, anchor, head)
        : TextSelection.create(doc, anchor, head),
  });
  const commands = Table.config.addCommands!.call({
    name: Table.name,
    options: Table.options,
    storage: Table.storage,
    editor,
    type: editor.schema.nodes.table,
    parent: undefined,
  });
  let transaction: Transaction | undefined;
  const props = new Proxy(
    {
      state,
      tr: state.tr,
      dispatch: (tr: Transaction) => {
        transaction = tr;
      },
    },
    {
      get(target, key) {
        if (!(key in target))
          throw new Error(`Backing table command requested renderer capability ${String(key)}`);
        return Reflect.get(target, key);
      },
    },
  ) as CommandProps;
  const accepted = commands[name]!()(props);
  const result = transaction ? state.applyTransaction(transaction).state : state;
  let nodes = 0;
  doc.descendants(() => {
    nodes++;
  });
  result.doc.descendants(() => {
    nodes++;
  });
  return {
    accepted,
    state: result,
    costs: {
      nodes,
      serializedBytes:
        bytes(JSON.stringify(doc.toJSON())) + bytes(JSON.stringify(result.doc.toJSON())),
    },
  };
}
