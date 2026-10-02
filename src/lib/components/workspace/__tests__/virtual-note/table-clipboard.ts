import {
  DOMParser,
  DOMSerializer,
  Fragment,
  Slice,
  type Schema,
  type Node as PMNode,
} from '@tiptap/pm/model';
import { __clipCells, __pastedCells, removeColSpan } from '@tiptap/pm/tables';
import { Transform } from '@tiptap/pm/transform';
import { getTextBetween, getTextSerializersFromSchema, type JSONContent } from '@tiptap/core';
import { processHTMLToMarkdown } from '$lib/utils/markdown-processor';
import { bytes } from './bounded-note-service';
import { scanTables, tableCellAt, tableRuns, type TableIndex } from './table-source';
import type { Selection } from './source-journal';

export type ClipboardValue = { 'text/plain': string; 'text/html': string };
export type ClipboardPage = {
  id: number;
  revision: number;
  index: number;
  count: number;
  mime: keyof ClipboardValue;
  payload: string;
};
export type ClipboardManifest = {
  id: number;
  revision: number;
  count: number;
  sizes: ClipboardValueSize;
  checksums: ClipboardValueSize;
};
type ClipboardValueSize = { 'text/plain': number; 'text/html': number };

/** Input-sized parsing and selection-sized repeated cells belong to mock backing,
 * not to the renderer relay. No complete target table/view is constructed here. */
export function parseTableClipboard(
  value: ClipboardValue,
  schema: Schema,
  width?: number,
  height?: number,
) {
  const container = document.createElement('div');
  const plain = !value['text/html'];
  if (plain) {
    // Native clipboard plain-text parsing collapses consecutive line separators.
    for (const block of value['text/plain'].split(/(?:\r\n?|\n)+/)) {
      const paragraph = container.appendChild(document.createElement('p'));
      if (block) paragraph.appendChild(document.createTextNode(block));
    }
  } else container.innerHTML = value['text/html'];
  const slice = DOMParser.fromSchema(schema).parseSlice(container, { preserveWhitespace: plain });
  let cells = __pastedCells(slice);
  const tableInput = !!cells;
  if (!cells) {
    const cell = schema.nodes.tableCell.createAndFill()!;
    const fitted = new Transform(cell).replace(0, cell.content.size, slice).doc;
    cells = { width: 1, height: 1, rows: [Fragment.from(fitted)] };
  }
  const fitted = __clipCells(cells, width ?? cells.width, height ?? cells.height);
  let nodes = 0;
  for (const row of fitted.rows)
    row.descendants(() => {
      nodes++;
    });
  return {
    cells: fitted,
    tableInput,
    costs: {
      inputBytes: bytes(value['text/html']) + bytes(value['text/plain']),
      elements: container.querySelectorAll('*').length,
      nodes,
      repeatedBytes: bytes(JSON.stringify(fitted.rows.map((row) => row.toJSON()))),
    },
  };
}

/** Serializes one externally owned pasted cell with the real canonical serializer. */
export function clipboardCellSource(cell: PMNode) {
  const container = document.createElement('div');
  container.append(DOMSerializer.fromSchema(cell.type.schema).serializeNode(cell));
  const markdown = processHTMLToMarkdown(`<table><tr>${container.innerHTML}</tr></table>`);
  const parsed = scanTables(markdown)[0].rows[0].cells[0];
  return markdown.slice(parsed.body, parsed.end);
}
const empty = (): ClipboardValue => ({ 'text/plain': '', 'text/html': '' });
const checksum = (text: string) => {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 16777619);
  return hash >>> 0;
};
const measured = (
  value: ClipboardValue,
  measure: (text: string) => number,
): ClipboardValueSize => ({
  'text/plain': measure(value['text/plain']),
  'text/html': measure(value['text/html']),
});

/** External mock backing serializer. Complete selected PM/DOM/output lives HERE,
 * never in a renderer view or page assembler. Same-process tests do not prove isolation. */
export function serializeTableClipboard(
  source: string,
  start: number,
  table: TableIndex,
  selection: NonNullable<Selection['table']>,
  schema: Schema,
  stored: (cell: number) => JSONContent | undefined,
) {
  const cells = table.rows.flatMap((r) => r.cells);
  const anchor = cells.find((c) => c.from + start === selection.anchor.cell),
    head = cells.find((c) => c.from + start === selection.head.cell);
  if (!anchor || !head) throw new Error('Stale clipboard cell selection');
  const top = Math.min(anchor.row, head.row),
    bottom = Math.max(anchor.row + (anchor.rowSpan ?? 1), head.row + (head.rowSpan ?? 1));
  const left = Math.min(anchor.column, head.column),
    right = Math.max(anchor.column + (anchor.span ?? 1), head.column + (head.span ?? 1));
  const seen = new Set<number>(),
    rows: PMNode[] = [],
    text: string[] = [];
  const textSerializers = getTextSerializersFromSchema(schema);
  let selectedSourceBytes = 0;
  for (let r = top; r < bottom; r++) {
    const contents: PMNode[] = [];
    for (let c = left; c < right; c++) {
      const entry = tableCellAt(table, r, c);
      if (seen.has(entry.from)) continue;
      seen.add(entry.from);
      const raw = source.slice(entry.body, entry.end);
      selectedSourceBytes += bytes(raw);
      let cell = schema.nodeFromJSON(
        stored(entry.from + start) ?? {
          type: entry.row === 0 ? 'tableHeader' : 'tableCell',
          attrs: { align: entry.align },
          content: [
            {
              type: 'paragraph',
              content: tableRuns(raw, entry.body).map((run) => ({
                type: run.hardBreak ? 'hardBreak' : 'text',
                ...(run.hardBreak ? {} : { text: run.text }),
                marks: run.marks,
              })),
            },
          ],
        },
      );
      // Native clipboard text visits selection ranges, not the clipped HTML slice.
      // Owners above/left of the rectangle contribute empty HTML continuation cells
      // but are absent from CellSelection.ranges and therefore from plain text.
      if (entry.row >= top && entry.column >= left)
        text.push(getTextBetween(cell, { from: 0, to: cell.content.size }, { textSerializers }));
      const extraLeft = left - entry.column,
        extraRight = entry.column + Number(cell.attrs.colspan) - right;
      if (extraLeft > 0 || extraRight > 0) {
        let attrs = cell.attrs as Parameters<typeof removeColSpan>[0];
        if (extraLeft > 0) attrs = removeColSpan(attrs, 0, extraLeft);
        if (extraRight > 0) attrs = removeColSpan(attrs, attrs.colspan - extraRight, extraRight);
        cell =
          extraLeft > 0 ? cell.type.createAndFill(attrs)! : cell.type.create(attrs, cell.content);
      }
      if (entry.row < top || entry.row + Number(cell.attrs.rowspan) > bottom) {
        const attrs = {
          ...cell.attrs,
          rowspan:
            Math.min(entry.row + Number(cell.attrs.rowspan), bottom) - Math.max(entry.row, top),
        };
        cell =
          entry.row < top ? cell.type.createAndFill(attrs)! : cell.type.create(attrs, cell.content);
      }
      contents.push(cell);
    }
    rows.push(schema.nodes.tableRow.create(null, contents));
  }
  const whole = top === 0 && bottom === table.rows.length && left === 0 && right === table.columns;
  const slice = new Slice(
    Fragment.from(whole ? schema.nodes.table.create(null, rows) : rows),
    1,
    1,
  );
  const doc = document.implementation.createHTMLDocument('clipboard');
  const wrap = doc.createElement('div');
  wrap.appendChild(
    DOMSerializer.fromSchema(schema).serializeFragment(slice.content, { document: doc }),
  );
  if (!whole) {
    const tableElement = doc.createElement('table'),
      body = doc.createElement('tbody');
    while (wrap.firstChild) body.appendChild(wrap.firstChild);
    tableElement.appendChild(body);
    wrap.appendChild(tableElement);
  }
  wrap.firstElementChild!.setAttribute('data-pm-slice', whole ? '1 1 []' : '1 1 -2 []');
  let nodes = 0;
  slice.content.descendants(() => {
    nodes++;
  });
  return {
    value: {
      'text/plain': text.join('\n\n'),
      'text/html': wrap.innerHTML,
    },
    costs: {
      selectedSourceBytes,
      nodes,
      elements: wrap.querySelectorAll('*').length,
      serializedPMBytes: bytes(JSON.stringify(slice.toJSON())),
    },
  };
}

/** Mock external clipboard producer: unbounded output and page arrays are backing-only. */
export class ClipboardBacking {
  private serial = 0;
  private snapshots = new Map<number, { manifest: ClipboardManifest; pages: string[] }>();
  stats = {
    maxOutputBytes: 0,
    maxStoredPagesBytes: 0,
    maxSelectedSourceBytes: 0,
    maxPMNodes: 0,
    maxDOMElements: 0,
    maxSerializedPMBytes: 0,
  };
  open(revision: number, result: ReturnType<typeof serializeTableClipboard>) {
    const id = ++this.serial,
      pages: ClipboardPage[] = [];
    for (const mime of ['text/plain', 'text/html'] as const) {
      let payload = '',
        payloadBytes = 0;
      const header = () =>
        bytes(
          JSON.stringify({
            id,
            revision,
            index: pages.length,
            count: Number.MAX_SAFE_INTEGER,
            mime,
            payload: '',
          }),
        );
      let headerBytes = header();
      for (const char of result.value[mime]) {
        const charBytes = bytes(JSON.stringify(char)) - 2;
        if (headerBytes + payloadBytes + charBytes > 4096) {
          pages.push({ id, revision, index: pages.length, count: 0, mime, payload });
          payload = '';
          payloadBytes = 0;
          headerBytes = header();
        }
        payload += char;
        payloadBytes += charBytes;
      }
      pages.push({ id, revision, index: pages.length, count: 0, mime, payload });
    }
    const manifest: ClipboardManifest = {
      id,
      revision,
      count: pages.length,
      sizes: measured(result.value, bytes),
      checksums: measured(result.value, checksum),
    };
    const encoded = pages.map((page) => JSON.stringify({ ...page, count: pages.length }));
    this.snapshots.set(id, { manifest, pages: encoded });
    this.stats.maxOutputBytes = Math.max(
      this.stats.maxOutputBytes,
      Object.values(manifest.sizes).reduce((a, b) => a + b, 0),
    );
    this.stats.maxStoredPagesBytes = Math.max(
      this.stats.maxStoredPagesBytes,
      encoded.reduce((n, p) => n + bytes(p), 0),
    );
    this.stats.maxSelectedSourceBytes = Math.max(
      this.stats.maxSelectedSourceBytes,
      result.costs.selectedSourceBytes,
    );
    this.stats.maxPMNodes = Math.max(this.stats.maxPMNodes, result.costs.nodes);
    this.stats.maxDOMElements = Math.max(this.stats.maxDOMElements, result.costs.elements);
    this.stats.maxSerializedPMBytes = Math.max(
      this.stats.maxSerializedPMBytes,
      result.costs.serializedPMBytes,
    );
    return JSON.parse(JSON.stringify(manifest)) as ClipboardManifest;
  }
  page(id: number, index: number) {
    const value = this.snapshots.get(id)?.pages[index];
    if (value === undefined) throw new Error('Missing clipboard page');
    return JSON.parse(value) as ClipboardPage;
  }
  close(id: number) {
    this.snapshots.delete(id);
  }
  get retainedBytes() {
    return [...this.snapshots.values()].reduce(
      (n, s) => n + s.pages.reduce((b, p) => b + bytes(p), 0),
      0,
    );
  }
}

/** Output-sized mock sink, explicitly external to the renderer accounting boundary. */
export class ExternalClipboardSink {
  private staging?: { manifest: ClipboardManifest; index: number; value: ClipboardValue };
  published: ClipboardValue = empty();
  maxStagingBytes = 0;
  publications = 0;
  lastPublication?: { id: number; revision: number };
  begin(manifest: ClipboardManifest) {
    if (this.staging) throw new Error('Clipboard publication already pending');
    this.staging = { manifest: structuredClone(manifest), index: 0, value: empty() };
  }
  accept(page: ClipboardPage) {
    const stage = this.staging;
    if (
      !stage ||
      bytes(JSON.stringify(page)) > 4096 ||
      page.id !== stage.manifest.id ||
      page.revision !== stage.manifest.revision ||
      page.count !== stage.manifest.count ||
      page.index !== stage.index ||
      !(page.mime in stage.value)
    )
      throw new Error('Invalid clipboard page sequence');
    stage.value[page.mime] += page.payload;
    stage.index++;
    this.maxStagingBytes = Math.max(
      this.maxStagingBytes,
      Object.values(stage.value).reduce((n, s) => n + bytes(s), 0),
    );
  }
  publish(revision: number) {
    const stage = this.staging;
    if (
      !stage ||
      stage.manifest.revision !== revision ||
      stage.index !== stage.manifest.count ||
      JSON.stringify(measured(stage.value, bytes)) !== JSON.stringify(stage.manifest.sizes) ||
      JSON.stringify(measured(stage.value, checksum)) !== JSON.stringify(stage.manifest.checksums)
    )
      throw new Error('Incomplete or stale clipboard publication');
    this.published = stage.value;
    this.lastPublication = { id: stage.manifest.id, revision: stage.manifest.revision };
    this.publications++;
    this.staging = undefined;
  }
  cancel() {
    this.staging = undefined;
  }
  discard() {
    this.cancel();
    this.published = empty();
    this.lastPublication = undefined;
  }
  get stagingBytes() {
    return this.staging ? Object.values(this.staging.value).reduce((n, s) => n + bytes(s), 0) : 0;
  }
}

export type ClipboardRelayStats = {
  maxPageBytes: number;
  maxTransientBytes: number;
  maxOutstandingPages: number;
  pages: number;
};
/** Renderer relay: one page at a time, never an output-sized array, DOM or string. */
export function relayClipboard(
  manifest: ClipboardManifest,
  read: (index: number) => ClipboardPage,
  sink: ExternalClipboardSink,
  revision: () => number,
  stats: ClipboardRelayStats,
  cancelled: () => boolean = () => false,
) {
  if (bytes(JSON.stringify(manifest)) > 4096) throw new Error('Clipboard manifest exceeds budget');
  sink.begin(manifest);
  try {
    for (let index = 0; index < manifest.count; index++) {
      if (cancelled() || revision() !== manifest.revision)
        throw new Error('Clipboard transfer cancelled or stale');
      const page = read(index),
        encoded = JSON.stringify(page),
        size = bytes(encoded);
      if (size > 4096) throw new Error('Clipboard page exceeds budget');
      stats.maxPageBytes = Math.max(stats.maxPageBytes, size);
      stats.maxTransientBytes = Math.max(
        stats.maxTransientBytes,
        3 * size + bytes(JSON.stringify(manifest)),
      );
      stats.maxOutstandingPages = Math.max(stats.maxOutstandingPages, 1);
      stats.pages++;
      sink.accept(JSON.parse(encoded));
    }
    if (cancelled()) throw new Error('Clipboard transfer cancelled');
    sink.publish(revision());
  } catch (error) {
    sink.cancel();
    throw error;
  }
}
