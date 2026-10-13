import {
  TableSourceView,
  sourcePayloadBytes,
  sourceLogicalBytes,
  type TableSourceOwnership,
} from './table-source-view';
import type { CommandHistory } from './command-history';
import { captureTableDOMReplacement } from './table-dom-replacement';
import { Mapping, ReplaceStep } from '@tiptap/pm/transform';
import { MixedProjection } from './mixed-projection';
import {
  relayClipboard,
  type ClipboardRelayStats,
  type ClipboardManifest,
} from './table-clipboard';
import { tableEditWork } from './table-inline-source';
import { tableCommands, type TableCommandName } from './table-native-command';
import { tableNodeBudget, tableResourceBound, measureTableDOM } from './table-resources';
import { tableRunWork } from './table-run-context';
import {
  decodeTablePages,
  TABLE_ACTIVE_BYTES,
  TABLE_NODE_LIMIT,
  type TablePage,
} from './table-transfer';
import { cloneTableWindow, tableAliasExpansionWork, tableCloneWork } from './table-payload';
import { Editor, Extension, type CommandProps } from '@tiptap/core';
import {
  Plugin,
  TextSelection,
  NodeSelection,
  EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { ResolvedPos } from '@tiptap/pm/model';
import { createEditorConfig } from '$lib/utils/editor-config';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { bytes } from './bounded-note-service';
import {
  LIMITS,
  SourceJournal,
  mapSelection,
  mapPoint,
  type Selection,
  type MixedCommand,
  type TablePoint,
  type Splice,
  type AnnotationPage,
  type AnnotationCursor,
} from './source-journal';
import { SourceProjection, openMark, closeMark, type InlineContext } from './source-projection';
import { continuationWindow, CONTINUATION } from './continuation-window';
import { layoutTable } from './table-layout';
import { CellSelection, tableEditingKey } from '@tiptap/pm/tables';

type TableRollbackFrame = { projection: SourceProjection; parent?: TableRollbackFrame };
type TableViewTarget = {
  position: number;
  point?: TablePoint;
  revision: number;
  generation: number;
  navigation: number;
};
type TableCoverageState = {
  cell: number;
  first?: number;
  last?: number;
  blocks?: { from: number; to: number };
  units: number;
  height: number;
  required: number;
  deficit: number;
  position: number;
  revision: number;
  generation: number;
  top: number;
  left: number;
  width: number;
  viewportHeight: number;
  font: string;
  target?: number;
  point?: TablePoint;
};

/** Test-only logical document. Production editor, APIs, annotations and size guard are unchanged. */
export class DocumentSession {
  private mixedKey?: { key: 'Backspace' | 'Delete'; doc: unknown; capture: boolean };
  clipboardInput?: ClipboardManifest;
  pasteTableSelection() {
    const manifest = this.clipboardInput;
    if (!manifest) throw new Error('Missing external clipboard input');
    const before = structuredClone(this.selection),
      generation = this.selectionGeneration;
    try {
      relayClipboard(
        manifest,
        (index) => this.service.clipboardInput.page(manifest.id, index),
        this.service.clipboardInputSink,
        () => this.service.revision,
        this.clipboardRelay,
      );
      if (generation !== this.selectionGeneration) throw new Error('Stale paste selection');
      const after = this.service.atomic(() => {
        this.service.beginChanges();
        const after = this.service.stageTablePaste(before, manifest.id, this.editor!);
        this.service.recordEdit(before, after, false);
        return after;
      });
      this.selection = after;
      this.selectionGeneration++;
      this.prevTime = 0;
      this.cache.clear();
      queueMicrotask(() => {
        void this.seek(after.head);
      });
    } finally {
      this.service.clipboardInput.close(manifest.id);
      this.service.clipboardInputSink.discard();
      this.clipboardInput = undefined;
    }
  }
  readonly clipboardRelay: ClipboardRelayStats = {
    maxPageBytes: 0,
    maxTransientBytes: 0,
    maxOutstandingPages: 0,
    pages: 0,
  };
  copyTableSelection() {
    const manifest = this.service.openTableClipboard(this.selection, this.editor!.schema);
    try {
      relayClipboard(
        manifest,
        (index) => this.service.clipboardBacking.page(manifest.id, index),
        this.service.clipboardSink,
        () => this.service.revision,
        this.clipboardRelay,
      );
    } finally {
      this.service.clipboardBacking.close(manifest.id);
    }
    return manifest;
  }

  cutTableSelection() {
    const before = structuredClone(this.selection),
      generation = this.selectionGeneration;
    const publication = this.copyTableSelection();
    if (generation !== this.selectionGeneration) throw new Error('Stale clipboard selection');
    const after = this.service.atomic(() => {
      this.service.beginChanges();
      const after = this.service.stageTableCut(before, publication.id, this.editor!.schema);
      this.service.recordEdit(before, after, false);
      return after;
    });
    this.selection = after;
    this.selectionGeneration++;
    this.prevTime = 0;
    this.cache.clear();
    queueMicrotask(() => {
      void this.seek(after.head);
    });
  }
  editor?: Editor;
  #projection?: SourceProjection;
  get projection() {
    return this.#projection;
  }
  set projection(next: SourceProjection | undefined) {
    // Old projections may still belong to rollback or an annotation response.
    // Drop their measurement before exposing the replacement: no scalar overlap
    // or extra lifetime, including Object.assign rollback and view destruction.
    if (next !== this.#projection) this.#projection?.list?.clearMeasurement();
    this.#projection = next;
  }
  selection: Selection = { anchor: 0, head: 0, affinity: 1, revision: 1 };
  active = -1;
  error = '';
  created = 0;
  destroyed = 0;
  parsedBytes = 0;
  maxParsedBytes = 0;
  maxProjectionInputBytes = 0;
  maxSourceContextBytes = 0;
  maxSeamMetadataBytes = 0;
  maxSeamAdmissionBytes = 0;
  maxResidentAndInFlightSeamBytes = 0;
  maxHighlightBytes = 0;
  highlightCalls = 0;
  inFlightBytes = 0;
  maxInFlightBytes = 0;
  acceptedRoots = 0;
  acceptedAppended = 0;
  rejectedTransactions = 0;
  lastRejection = '';
  private drainingInput = false;
  private replayingInput = false;
  private replayTime?: number;
  private residentInputBytes = 0;
  private maxResidentInputBytes = 0;
  private windowEnd = 0;
  private continuation = false;
  private selectionGeneration = 0;
  private pointerSelecting = false;
  private continuationQueued = false;
  private pointerAnchor?: number;
  private pointerRemapped = false;
  private pointerDown = (event: PointerEvent) => {
    this.pointerSelecting = true;
    this.pointerRemapped = false;
    const pos = this.editor?.view.posAtCoords({ left: event.clientX, top: event.clientY });
    this.pointerAnchor = pos ? this.projection?.sourceAt(pos.pos) : undefined;
  };
  private pointerUp = () => {
    const editor = this.editor;
    if (
      this.pointerRemapped &&
      this.projection?.table &&
      editor?.state.selection instanceof CellSelection
    ) {
      // Native Chrome dragging defers selection normalization. After a crop,
      // its range still references the replaced DOM; reconcile that range before
      // the table plugin releases its selectingCells state on mouseup.
      const anchor = editor.view.domAtPos(editor.state.selection.anchor);
      const head = editor.view.domAtPos(editor.state.selection.head);
      editor.view.dom.ownerDocument
        .getSelection()
        ?.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
      editor.view.focus();
    }
    this.pointerSelecting = false;
    // A drag can briefly cross the table DOM boundary before landing in a cell.
    // Keep its geometry stable and resolve only the released raw endpoints.
    const dom = editor?.view.dom.ownerDocument.getSelection();
    if (
      editor &&
      dom?.anchorNode &&
      dom.focusNode &&
      editor.view.dom.contains(dom.anchorNode) &&
      editor.view.dom.contains(dom.focusNode)
    ) {
      const doc = editor.state.doc;
      const anchor = doc.resolve(editor.view.posAtDOM(dom.anchorNode, dom.anchorOffset));
      const head = doc.resolve(editor.view.posAtDOM(dom.focusNode, dom.focusOffset));
      if (this.fromDOMBoundary(editor.view, anchor, head, 1)) return;
    }
    this.continueNearEdge();
  };
  private cache = new Map<string, string>();
  private navigation = 0;
  private suppress = false;
  private prevTime = 0;
  private prevComposition: number | undefined;
  private prevRanges: [number, number][] = [];
  private pendingFetch?: Promise<void>;
  private pendingNavigation?: (accepted: boolean) => void;
  private rollbackState?: EditorState;
  delayFetch?: () => Promise<void>;
  delayAnnotationResponse?: () => Promise<void>;
  annotationPage?: AnnotationPage;
  private annotationTicket = 0;
  private annotationFlight?: Promise<void>;
  private annotationRange = '';
  annotationInFlightBytes = 0;
  maxAnnotationInFlightBytes = 0;
  maxAnnotationCacheBytes = 0;
  private annotationRanges(p: SourceProjection): Array<{ from: number; to: number }> {
    const ranges = p.mixed
      ? p.mixed.parts.flatMap((part) => this.annotationRanges(part.projection))
      : p.table
        ? p.table.window.cells.map((cell) => ({ from: cell.first, to: cell.last }))
        : [{ from: p.start, to: p.start + p.source.length }];
    // Mounted merged-cell owners can appear in visual rather than source order.
    // Query the union of admitted intervals without including unloaded gaps.
    ranges.sort((a, b) => a.from - b.from || a.to - b.to);
    const ordered: Array<{ from: number; to: number }> = [];
    for (const range of ranges) {
      const previous = ordered.at(-1);
      if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
      else ordered.push({ ...range });
    }
    return ordered;
  }
  /** A visible page, not a note-wide anchor map. Superseded replies cannot repaint. */
  async loadAnnotations(cursor?: AnnotationCursor) {
    const p = this.projection;
    if (!p) return false;
    const ticket = ++this.annotationTicket;
    if (this.annotationFlight) await this.annotationFlight;
    if (ticket !== this.annotationTicket || p !== this.projection) return false;
    let release!: () => void;
    const flight = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.annotationFlight = flight;
    try {
      const { revision, generation, commentRevision } = this.service;
      const ranges = this.annotationRanges(p);
      const range = { from: ranges[0].from, to: ranges.at(-1)!.to };
      if (cursor && JSON.stringify(cursor.ranges ?? [range]) !== JSON.stringify(ranges))
        throw new Error('Stale annotations cursor');
      const page = this.service.annotations(range.from, range.to, revision, generation, {
        commentRevision,
        cursor,
        ...(!cursor && (p.table || p.mixed) ? { ranges } : {}),
      });
      this.annotationInFlightBytes = bytes(JSON.stringify(page));
      this.maxAnnotationInFlightBytes = Math.max(
        this.maxAnnotationInFlightBytes,
        this.annotationInFlightBytes,
      );
      if (this.delayAnnotationResponse) await this.delayAnnotationResponse();
      if (
        ticket !== this.annotationTicket ||
        p !== this.projection ||
        revision !== this.service.revision ||
        generation !== this.service.generation ||
        commentRevision !== this.service.commentRevision
      )
        return false;
      const prefix = `annotations:${revision}:${generation}:${commentRevision}:`;
      for (const key of this.cache.keys())
        if (key.startsWith('annotations:') && !key.startsWith(prefix)) this.cache.delete(key);
      const key = `${prefix}${range.from}:${range.to}:${cursor?.offset ?? 0}`;
      this.cache.delete(key);
      this.cache.set(key, JSON.stringify(page));
      while (
        this.cache.size > LIMITS.cachePages ||
        [...this.cache.values()].reduce((n, value) => n + bytes(value), 0) > LIMITS.active
      )
        this.cache.delete(this.cache.keys().next().value!);
      this.maxAnnotationCacheBytes = Math.max(
        this.maxAnnotationCacheBytes,
        [...this.cache]
          .filter(([key]) => key.startsWith('annotations:'))
          .reduce((n, [, value]) => n + bytes(value), 0),
      );
      this.annotationPage = page;
      this.annotationRange = JSON.stringify(ranges);
      if (this.editor && !this.editor.isDestroyed) this.editor.view.setProps({});
      this.changed();
      return true;
    } finally {
      this.annotationInFlightBytes = 0;
      if (this.annotationFlight === flight) this.annotationFlight = undefined;
      release();
    }
  }
  constructor(
    readonly service: SourceJournal,
    private host: HTMLElement,
    private changed = () => {},
  ) {
    host.addEventListener('pointerdown', this.pointerDown);
    document.addEventListener('pointerup', this.pointerUp);
  }
  private get tableIntentBytes() {
    return [
      ...new Set([
        this.tableScrollRequest,
        this.tableCoverageRequest,
        this.tableViewTarget,
        this.tableTargetCandidate,
        this.tableCoverageState,
        this.tableCoverageFailure,
      ]),
    ].reduce((size, value) => size + (value ? bytes(JSON.stringify(value)) : 0), 0);
  }
  private checkTableIntentBudget() {
    if (!this.projection?.tableSource) return;
    const size =
      this.projection.sourcePayloadBytes +
      bytes(JSON.stringify(this.projection.context)) +
      this.tableIntentBytes;
    this.maxTableIntentAdmissionBytes = Math.max(this.maxTableIntentAdmissionBytes, size);
    if (size > TABLE_ACTIVE_BYTES) throw new Error('Table viewport intent exceeds source budget');
    this.maxSourceContextBytes = Math.max(this.maxSourceContextBytes, size);
  }
  private project(
    source: string | TableSourceView,
    start: number,
    table?: InlineContext['table'],
    fragments?: InlineContext['fragments'],
  ) {
    if (sourcePayloadBytes(source) > LIMITS.active)
      throw new Error('Proof projection exceeds experiment budget');
    this.parsedBytes += sourceLogicalBytes(source);
    this.maxParsedBytes = Math.max(this.maxParsedBytes, sourceLogicalBytes(source));
    const context: InlineContext = fragments
      ? {
          revision: this.service.revision,
          from: start,
          to: fragments.at(-1)!.context.to,
          before: [],
          after: [],
          fragments,
        }
      : table
        ? {
            revision: table.revision,
            from: start,
            to: table.cells.at(-1)!.last,
            before: [],
            after: [],
            table,
          }
        : this.service.inlineContext(start, start + source.length);
    if (!table && !fragments) {
      const ranges = this.service.mixedTableRanges(start, start + source.length);
      if (ranges.length)
        context.tables = ranges.map((range) => {
          const part = this.receiveTable(
            this.service.tableWindowPages(range.from, undefined, undefined, {
              row: 0,
              column: 0,
              rowCount: range.rows,
              columnCount: range.columns,
            }),
          )!;
          if (
            part.cells.some((cell) => cell.partial) ||
            part.cells.length !== part.rows * part.columns
          )
            throw new Error('Mixed table requires complete bounded admission');
          return part;
        });
      if (
        ranges.length &&
        sourcePayloadBytes(source) + bytes(JSON.stringify(context)) + this.domBoundaryBytes >
          TABLE_ACTIVE_BYTES
      )
        throw new Error('Mixed source/context exceeds admission budget');
    }
    if (
      fragments &&
      (sourcePayloadBytes(source) + bytes(JSON.stringify(context)) + this.domBoundaryBytes >
        TABLE_ACTIVE_BYTES ||
        fragments.some((f) => f.context.revision !== this.service.revision))
    )
      throw new Error('Sparse mixed admission exceeds budget or revision');
    if (context.revision !== this.service.revision)
      throw new Error('Stale inline context response');
    this.maxSourceContextBytes = Math.max(
      this.maxSourceContextBytes,
      sourcePayloadBytes(source) +
        bytes(JSON.stringify(context)) +
        this.domBoundaryBytes +
        this.tableIntentBytes,
    );
    this.maxSeamMetadataBytes = Math.max(
      this.maxSeamMetadataBytes,
      bytes(JSON.stringify(context.seams ?? [])),
    );
    this.maxResidentAndInFlightSeamBytes = Math.max(
      this.maxResidentAndInFlightSeamBytes,
      bytes(JSON.stringify(context.seams ?? [])) +
        bytes(JSON.stringify(this.projection?.context?.seams ?? [])) +
        bytes(JSON.stringify(this.projection?.list?.seams ?? [])),
    );
    // The parser adds only this metadata-derived envelope, never a source prefix.
    this.maxProjectionInputBytes = Math.max(
      this.maxProjectionInputBytes,
      sourcePayloadBytes(source) +
        bytes(JSON.stringify(context.fences ?? [])) +
        bytes(JSON.stringify(context.lists ?? [])) +
        bytes(JSON.stringify(context.seams ?? [])) +
        bytes(context.before.map(openMark).join('') + context.after.map(closeMark).join('')),
    );
    const next = new SourceProjection(source, start, context);
    if (next.tableSource) {
      this.measureTableOwners(next);
      if (
        next.sourcePayloadBytes + bytes(JSON.stringify(context)) + this.tableIntentBytes >
        TABLE_ACTIVE_BYTES
      )
        throw new Error('Standalone table owner and descriptor exceed source budget');
    }
    return next;
  }
  private readRange(from: number, to: number) {
    if (to - from > LIMITS.active) throw new Error('Unbounded source range');
    let source = '';
    for (let offset = from; offset < to;) {
      // UTF-16 span capped at 1024 => at most 4096 UTF-8 bytes, without splitting a surrogate.
      let end = Math.min(offset + 1024, to);
      if (end < to && this.service.splitsSurrogate(end)) end--;
      const key = `${this.service.revision}:${offset}:${end}`;
      const page = this.cache.get(key) ?? this.service.read(offset, end).source;
      this.cache.delete(key);
      this.cache.set(key, page);
      while (this.cache.size > LIMITS.cachePages)
        this.cache.delete(this.cache.keys().next().value!);
      source += page;
      offset = end;
      if (bytes(source) > LIMITS.active)
        throw new Error('Proof projection exceeds experiment budget');
    }
    return source;
  }
  // Mirrors actual synchronous rollback references, including reentrant acceptance.
  // Frames are popped in finally; no outgoing owner registry survives acceptance.
  private tableRollback?: TableRollbackFrame;
  private measureTableOwners(candidate?: SourceProjection) {
    const projections: SourceProjection[] = [];
    let rollbackFrames = 0;
    const add = (p?: SourceProjection) => {
      if (p?.tableSource && !projections.includes(p)) projections.push(p);
    };
    for (let frame = this.tableRollback; frame; frame = frame.parent) {
      rollbackFrames++;
      add(frame.projection);
    }
    add(this.projection);
    add(candidate);
    const owners: NonNullable<InlineContext['table']>['cells'][] = [];
    const payload = projections.map((p) => {
      const window = p.table!.window;
      let owner = owners.indexOf(window.cells);
      if (owner < 0) {
        owner = owners.length;
        owners.push(window.cells);
      }
      return {
        source: p.tableSource!.descriptor,
        context: { ...p.context, table: { ...window, cells: { owner } } },
      };
    });
    const descriptorBytes = projections.reduce((n, p) => n + p.tableSource!.payloadBytes, 0);
    // Reference encoding charges each distinct packed owner once and every live
    // descriptor/context separately. This is serialized payload, not heap usage.
    const payloadBytes = projections.length
      ? bytes(JSON.stringify({ owners, projections: payload }))
      : 0;
    this.maxTableSourceOwnerOverlap = Math.max(this.maxTableSourceOwnerOverlap, owners.length);
    this.maxTableDescriptorOverlapBytes = Math.max(
      this.maxTableDescriptorOverlapBytes,
      descriptorBytes,
    );
    this.maxTableLivePayloadBytes = Math.max(this.maxTableLivePayloadBytes, payloadBytes);
    this.maxTableRollbackFrames = Math.max(this.maxTableRollbackFrames, rollbackFrames);
    this.maxTableResidentAndAssemblyBytes = Math.max(
      this.maxTableResidentAndAssemblyBytes,
      payloadBytes,
    );
    return { ownerCount: owners.length, descriptorBytes, payloadBytes, rollbackFrames };
  }
  maxTableLivePayloadBytes = 0;
  maxTableRollbackFrames = 0;
  maxTableSourceOwnerOverlap = 0;
  maxTableDescriptorOverlapBytes = 0;
  maxTableCacheAndDecodeBytes = 0;
  tableReceiveAccounting = {
    wireBytes: 0,
    decodeBufferBytes: 0,
    decodedOwnerBytes: 0,
    previousProjectionBytes: 0,
    cacheBeforeBytes: 0,
    cachePeakBytes: 0,
  };
  debugPublicationBytes = 0;
  maxDebugPublicationOverlapBytes = 0;
  recordDebugPublication(size: number) {
    this.maxDebugPublicationOverlapBytes = Math.max(
      this.maxDebugPublicationOverlapBytes,
      this.debugPublicationBytes + size,
    );
    this.debugPublicationBytes = size;
  }
  maxTableTransferPageBytes = 0;
  maxTableTransferBytes = 0;
  maxTableAssemblyBytes = 0;
  maxTableRestoreAnchorBytes = 0;
  maxTableResidentAndAssemblyBytes = 0;
  private receiveTable(pages: TablePage[] | undefined, ownership: TableSourceOwnership = 'copied') {
    if (!pages) return undefined;
    const encodedBytes = pages.reduce((n, p) => n + bytes(JSON.stringify(p)), 0);
    const assemblyBytes = pages.reduce((n, p) => n + bytes(p.payload), 0);
    this.maxTableTransferBytes = Math.max(this.maxTableTransferBytes, encodedBytes);
    this.maxTableAssemblyBytes = Math.max(this.maxTableAssemblyBytes, encodedBytes + assemblyBytes);
    const window = decodeTablePages(pages, this.service.revision, ownership);
    const receipt = {
      wireBytes: encodedBytes,
      decodeBufferBytes: assemblyBytes,
      decodedOwnerBytes: bytes(JSON.stringify(window)),
      previousProjectionBytes:
        this.measureTableOwners().payloadBytes +
        (this.projection?.tableSource
          ? 0
          : (this.projection?.sourcePayloadBytes ?? 0) +
            bytes(JSON.stringify(this.projection?.context ?? {}))),
      cacheBeforeBytes: [...this.cache.values()].reduce((n, value) => n + bytes(value), 0),
      cachePeakBytes: 0,
    };
    receipt.cachePeakBytes = receipt.cacheBeforeBytes;
    this.tableReceiveAccounting = receipt;

    this.maxTableResidentAndAssemblyBytes = Math.max(
      this.maxTableResidentAndAssemblyBytes,
      encodedBytes +
        assemblyBytes +
        bytes(JSON.stringify(window)) +
        receipt.previousProjectionBytes,
    );
    for (const page of pages) {
      const payload = JSON.stringify(page);
      this.maxTableTransferPageBytes = Math.max(this.maxTableTransferPageBytes, bytes(payload));
      const key = `table:${page.revision}:${window.from}:${window.cells[0].first}:${page.index}`;
      this.cache.delete(key);
      // Evict before inserting: the live cache never briefly owns a fifth page.
      while (
        this.cache.size >= LIMITS.cachePages ||
        [...this.cache.values()].reduce((n, v) => n + bytes(v), 0) + bytes(payload) >
          TABLE_ACTIVE_BYTES
      )
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, payload);
      receipt.cachePeakBytes = Math.max(
        receipt.cachePeakBytes,
        [...this.cache.values()].reduce((n, v) => n + bytes(v), 0),
      );
    }
    this.maxTableCacheAndDecodeBytes = Math.max(
      this.maxTableCacheAndDecodeBytes,
      receipt.cachePeakBytes + encodedBytes + assemblyBytes + receipt.decodedOwnerBytes,
    );
    return window;
  }
  private domBoundaryPending = false;
  private domBoundaryBytes = 0;
  maxDOMBoundaryIntentBytes = 0;
  private fromDOMBoundary(
    view: EditorView,
    anchor: ResolvedPos,
    head: ResolvedPos,
    pointerBias?: number,
  ) {
    const projection = this.projection;
    const part = projection?.mixed?.parts.find((p) => p.projection.table && head.pos === p.pm + 1);
    const table = part?.projection.table;
    if (
      !part ||
      !table ||
      head.parent.type.name !== 'table' ||
      this.suppress ||
      view.composing ||
      this.pointerSelecting
    )
      return null;
    const first = table.window.cells[0];
    if (!first || (first.row === 0 && first.column === 0 && first.first === first.body))
      return null;
    // This callback receives ProseMirror's actual DOM-resolved endpoints, before
    // cropped table normalization can turn its leading edge into the wrong cell.
    const collapsed = anchor.pos === head.pos;
    if (!collapsed && anchor.pos <= part.end) return null;
    if (this.domBoundaryPending) return view.state.selection;
    const intent = {
      revision: this.service.revision,
      generation: this.selectionGeneration,
      table: table.window.from,
      anchor: collapsed ? undefined : projection!.sourceAt(anchor.pos),
      collapsed,
      bias: pointerBias ?? (view.state.selection.head < head.pos ? 1 : -1),
    };
    const intentBytes = bytes(JSON.stringify(intent));
    if (
      intentBytes > LIMITS.request ||
      projection!.sourcePayloadBytes + bytes(JSON.stringify(projection!.context)) + intentBytes >
        TABLE_ACTIVE_BYTES
    )
      throw new Error('DOM boundary intent exceeds admission budget');
    this.domBoundaryPending = true;
    this.domBoundaryBytes = intentBytes;
    this.maxDOMBoundaryIntentBytes = Math.max(this.maxDOMBoundaryIntentBytes, intentBytes);
    const editor = this.editor;
    queueMicrotask(() => {
      void (async () => {
        if (
          this.editor !== editor ||
          this.projection !== projection ||
          this.service.revision !== intent.revision ||
          this.selectionGeneration !== intent.generation
        )
          return;
        const first = this.service.tableAddress(intent.table, 0, 0);
        if (first.revision !== intent.revision) return;
        let selected: Selection = {
          revision: intent.revision,
          anchor: first.source,
          head: first.source,
          affinity: 1,
          table: { kind: 'text', anchor: first.point, head: first.point },
        };
        if (!intent.collapsed) {
          const normalized = this.service.stageLogicalTableCommand(
            {
              revision: intent.revision,
              table: intent.table,
              command: 'normalizeLeadingBoundary',
              selection: selected,
            },
            editor!,
            false,
          );
          if (!normalized) throw new Error('Native boundary normalization failed');
          selected = normalized;
        }
        if (
          !(await this.show(
            this.active,
            true,
            intent.collapsed ? first.source : selected.head,
            true,
            selected,
            selected.table?.head,
            intent.collapsed ? intent.anchor : undefined,
          ))
        )
          return;
        if (this.service.revision !== intent.revision || this.editor !== editor) return;
        if (!intent.collapsed) {
          this.selectionGeneration++;
          this.changed();
          return;
        }
        const current = this.projection!.mixed?.parts.find(
          (p) => p.projection.table?.window.from === intent.table,
        );
        if (!current) throw new Error('DOM boundary lost its table provenance');
        const doc = editor!.state.doc,
          rawHead = current.pm + 1;
        const rawAnchor = intent.collapsed ? rawHead : this.projection!.pmAt(intent.anchor!);
        editor!.view.dispatch(
          editor!.state.tr
            .setSelection(
              TextSelection.between(doc.resolve(rawAnchor), doc.resolve(rawHead), intent.bias),
            )
            .scrollIntoView(),
        );
      })()
        .catch((error) => {
          this.error = String(error);
          this.changed();
        })
        .finally(() => {
          this.domBoundaryPending = false;
          this.domBoundaryBytes = 0;
        });
    });
    return view.state.selection;
  }
  private sparseWindow(position: number, selection = this.selection, boundaryAnchor?: number) {
    const boundary = this.service.mixedBoundary(position);
    if (!boundary) return undefined;
    let from = this.service.inlineBoundary(boundary.from, 1),
      to = this.service.inlineBoundary(boundary.to, -1);
    const raw = this.readRange(from, to);
    const leading = raw.match(/^\n*/)?.[0].length ?? 0,
      trailing = raw.match(/\n*$/)?.[0].length ?? 0;
    from += leading;
    to -= trailing;
    const source = raw.slice(leading, raw.length - trailing);
    const prose = { source, start: from, context: this.service.inlineContext(from, to) };
    const table = this.receiveTable(
      this.service.tableWindowPages(boundary.at, undefined, undefined, undefined, selection.table),
    )!;
    table.trailing = false;
    const cells = {
      source: table.cells.map((c) => c.raw).join(''),
      start: table.from,
      context: {
        revision: table.revision,
        from: table.from,
        to: table.to,
        before: [],
        after: [],
        table,
      } as InlineContext,
    };
    const fragments = boundary.side === 'before' ? [prose, cells] : [cells, prose];
    if (boundaryAnchor !== undefined && boundaryAnchor > table.to) {
      const other = this.service.mixedBoundary(boundaryAnchor);
      if (
        !other ||
        other.revision !== table.revision ||
        other.side !== 'after' ||
        other.from !== table.to
      )
        throw new Error('DOM boundary anchor no longer neighbors its table');
      const raw = this.readRange(other.from, other.to),
        leading = raw.match(/^\n*/)?.[0].length ?? 0,
        trailing = raw.match(/\n*$/)?.[0].length ?? 0;
      const from = other.from + leading,
        to = other.to - trailing;
      if (boundaryAnchor < from || boundaryAnchor > to)
        throw new Error('DOM boundary anchor outside admitted prose');
      fragments.push({
        source: raw.slice(leading, raw.length - trailing),
        start: from,
        context: this.service.inlineContext(from, to),
      });
    }
    const joined = fragments.map((f) => f.source).join('');
    this.inFlightBytes += bytes(joined);
    this.maxInFlightBytes = Math.max(this.maxInFlightBytes, this.inFlightBytes);
    return {
      from: fragments[0].start,
      to: fragments.at(-1)!.context.to,
      source: joined,
      table: undefined,
      fragments,
      continuation: true,
    };
  }
  private refreshSparse(splices: Splice[]) {
    const fragments = this.projection!.context!.fragments!.map((fragment) => {
      let from = fragment.start,
        to = fragment.context.to;
      const retained = fragment.context.table && cloneTableWindow(fragment.context.table);
      for (const splice of splices) {
        from = mapPoint(from, splice, -1);
        to = mapPoint(to, splice, 1);
        for (const cell of retained?.cells ?? []) {
          cell.first = mapPoint(cell.first, splice, -1);
          cell.last = mapPoint(cell.last, splice, 1);
        }
      }
      if (retained) {
        const table = this.receiveTable(
          this.service.tableWindowPages(retained.cells[0].first, retained),
        )!;
        table.trailing = false;
        return {
          source: table.cells.map((c) => c.raw).join(''),
          start: table.from,
          context: {
            revision: table.revision,
            from: table.from,
            to: table.to,
            before: [],
            after: [],
            table,
          } as InlineContext,
        };
      }
      return {
        source: this.readRange(from, to),
        start: from,
        context: this.service.inlineContext(from, to),
      };
    });
    this.windowEnd = fragments.at(-1)!.context.to;
    return this.project(
      fragments.map((f) => f.source).join(''),
      fragments[0].start,
      undefined,
      fragments,
    );
  }
  private readWindow(
    id: number,
    position?: number,
    selection = this.selection,
    boundaryAnchor?: number,
  ) {
    const at = position ?? this.service.start(id);
    const sparse = this.sparseWindow(at, selection, boundaryAnchor);
    if (sparse) return sparse;
    const candidate = continuationWindow(this.service, id, position);
    const mixedRanges = this.service.mixedTableRanges(candidate.from, candidate.to);
    if (mixedRanges.length && mixedRanges.every((range) => range.complete)) {
      const source = this.readRange(candidate.from, candidate.to);
      this.inFlightBytes += bytes(source);
      this.maxInFlightBytes = Math.max(this.maxInFlightBytes, this.inFlightBytes);
      return { ...candidate, source, table: undefined };
    }
    const scroller = this.host.parentElement;
    const target = this.currentTableTarget();
    const preferred =
      target?.position === at
        ? target.point
        : position === selection.head
          ? selection.table?.head
          : undefined;
    const pages = scroller?.clientHeight
      ? this.service.tableViewportPages(
          at,
          {
            height: scroller.clientHeight,
            width: scroller.clientWidth,
            font: this.tableFont(),
            include: this.pointerSelecting ? this.selection.table?.anchor.cell : undefined,
            nearby: selection.table?.kind === 'cell' ? selection.table.anchor.cell : undefined,
            ...(!this.drainingInput && this.tableScrollRequest?.position === at
              ? this.tableScrollRequest
              : {}),
            ...(target?.position === at ? { retainTarget: true } : {}),
          },
          preferred,
          selection.table,
          'packed-cells',
        )
      : this.service.tableWindowPages(
          at,
          undefined,
          preferred,
          undefined,
          selection.table,
          'packed-cells',
        );
    const table = this.receiveTable(pages, 'packed-cells');
    if (table) {
      const source = new TableSourceView(table);
      const from = table.cells[0].first,
        to = table.cells.at(-1)!.last;
      this.inFlightBytes += sourcePayloadBytes(source);
      this.maxInFlightBytes = Math.max(this.maxInFlightBytes, this.inFlightBytes);
      return { from, to, source, table, continuation: true };
    }
    const bounds = candidate;
    bounds.from = this.service.inlineBoundary(bounds.from, 1);
    bounds.to = this.service.inlineBoundary(bounds.to, -1);
    Object.assign(bounds, this.service.listWindow(bounds.from, bounds.to, position ?? bounds.from));
    const source = this.readRange(bounds.from, bounds.to);
    this.inFlightBytes += bytes(source);
    this.maxInFlightBytes = Math.max(this.maxInFlightBytes, this.inFlightBytes);
    return { ...bounds, source, table: undefined };
  }
  /** A source coordinate identifies a continuation; page edges never enter the source. */
  seek(position: number, restore = true, anchorPoint = this.selection.table?.head) {
    return this.show(
      Math.min(this.service.locate(position).id, Math.max(0, this.service.count - 2)),
      restore,
      position,
      false,
      undefined,
      anchorPoint,
    );
  }
  private deferInput(command: string, text?: string) {
    const chunks: Array<string | undefined> = [];
    if ((this.projection?.list || this.projection?.table) && text && text.length > 128) {
      for (let from = 0; from < text.length;) {
        let to = Math.min(from + 128, text.length);
        if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
        chunks.push(text.slice(from, to));
        from = to;
      }
    } else chunks.push(text);
    for (const chunk of chunks)
      this.service.enqueueInput({
        command,
        text: chunk,
        time: Date.now(),
        selection: this.service.pendingInputs ? undefined : { ...this.selection },
      });
    void this.drainInput();
    this.changed();
  }
  private async drainInput() {
    if (this.drainingInput) return;
    this.drainingInput = true;
    try {
      while (this.service.pendingInputs && this.editor && !this.editor.isDestroyed) {
        const input = this.service.readInput();
        this.residentInputBytes = bytes(JSON.stringify(input));
        this.maxResidentInputBytes = Math.max(this.maxResidentInputBytes, this.residentInputBytes);
        const logical = input.selection ?? this.selection;
        const neighbor =
          (input.command.startsWith('tableArrow') || input.command.startsWith('tableExtend')) &&
          logical.table
            ? this.service.tableAdjacent(
                logical.table.head.cell,
                /(?:Up|Down)$/.test(input.command) ? 'vert' : 'horiz',
                /(?:Up|Left)$/.test(input.command) ? -1 : 1,
              )
            : (input.command.startsWith('tableTab') ||
                  input.command.startsWith('tableHorizontal')) &&
                logical.table
              ? this.service.tableNeighbor(
                  logical.table.head.cell,
                  /(?:Backward|Left)$/.test(input.command) ? -1 : 1,
                  input.command === 'tableHorizontalLeft',
                )
              : undefined;
        const tabEnd =
          input.command.startsWith('tableTab') && logical.table
            ? this.service.tableNeighbor(
                logical.table.head.cell,
                input.command.endsWith('Backward') ? -1 : 1,
                true,
              )
            : undefined;
        const target =
          tabEnd?.source ?? neighbor?.source ?? input.selection?.head ?? this.selection.head;
        const extending = input.command.startsWith('tableExtend');
        const neighborSelection: Selection | undefined = neighbor && {
          anchor: extending ? logical.anchor : neighbor.source,
          head: tabEnd?.source ?? neighbor.source,
          affinity: extending && logical.anchor > neighbor.source ? -1 : 1,
          revision: this.service.revision,
          table: {
            anchor: extending ? { ...logical.table!.anchor, block: 0, offset: 0 } : neighbor.point,
            head: tabEnd?.point ?? neighbor.point,
            kind: extending ? 'cell' : 'text',
          },
        };
        // Share the outstanding fetch, but retain the input if navigation becomes stale.
        if (!(await this.show(this.active, true, target, true, neighborSelection))) {
          if (!this.editor || this.editor.isDestroyed || this.editor.view.composing) break;
          continue;
        }
        // show rejects revision changes, so this bounded record is still current.
        const current = input;
        if (current.selection && !neighbor) {
          this.selection = { ...current.selection };
          this.suppress = true;
          this.renderSelection();
          this.suppress = false;
        }
        if (current.command !== 'selection') {
          this.editor.view.focus();
          this.replayingInput = true;
          this.replayTime = current.time;
          // Chromium performs the actual character/grapheme operation on bounded context.
          // MutationObserver delivers its transaction before the next input task.
          let accepted = true;
          if (neighbor) {
            this.selection = neighborSelection!;
            this.selectionGeneration++;
            this.suppress = true;
            this.renderSelection();
            this.suppress = false;
          } else if (current.command === 'undo' || current.command === 'redo')
            await this.history(current.command === 'redo');
          else if (['insertParagraph', 'indent', 'outdent'].includes(current.command)) {
            // Enter is a keymap transaction, not a browser beforeinput operation.
            // Replay that same keymap after context arrives, with the saved timestamp.
            const view = this.editor.view;
            const event = new KeyboardEvent('keydown', {
              key: current.command === 'insertParagraph' ? 'Enter' : 'Tab',
              shiftKey: current.command === 'outdent',
              cancelable: true,
            });
            accepted = !!view.someProp('handleKeyDown', (handler) => handler(view, event));
          } else if (/^tableText(Move|Extend)(Up|Down|Left|Right)$/.test(current.command)) {
            const selection = window.getSelection()!;
            selection.modify(
              current.command.includes('Extend') ? 'extend' : 'move',
              /(?:Up|Left)$/.test(current.command) ? 'backward' : 'forward',
              /(?:Up|Down)$/.test(current.command) ? 'line' : 'character',
            );
            const view = this.editor.view;
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.create(
                  view.state.doc,
                  view.posAtDOM(selection.anchorNode!, selection.anchorOffset),
                  view.posAtDOM(selection.focusNode!, selection.focusOffset),
                ),
              ),
            );
          } else if (/^(move|extend)(Forward|Backward)$/.test(current.command)) {
            const selection = window.getSelection()!;
            selection.modify(
              current.command.startsWith('extend') ? 'extend' : 'move',
              current.command.endsWith('Backward') ? 'backward' : 'forward',
              'character',
            );
            const view = this.editor.view;
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.create(
                  view.state.doc,
                  view.posAtDOM(selection.anchorNode!, selection.anchorOffset),
                  view.posAtDOM(selection.focusNode!, selection.focusOffset),
                ),
              ),
            );
          } else if (
            current.command === 'insertText' &&
            current.text &&
            this.editor.state.selection.empty &&
            this.editor.state.selection.$from.parent.type.spec.code
          ) {
            // Re-enter the native text-input pipeline after admitting the code
            // context. execCommand retains a browser editing range across the
            // canceled input and can delete unrelated text after a keymap Enter.
            const view = this.editor.view;
            const { from, to } = view.state.selection;
            const text = current.text;
            const defaultInput = () => view.state.tr.insertText(text, from, to).scrollIntoView();
            if (
              !view.someProp('handleTextInput', (handler) =>
                handler(view, from, to, text, defaultInput),
              )
            )
              view.dispatch(defaultInput());
          } else accepted = document.execCommand(current.command, false, current.text);
          await Promise.resolve();
          this.replayingInput = false;
          this.replayTime = undefined;
          if (!accepted || this.error) throw new Error(this.error || 'Native input replay failed');
        }
        this.service.acknowledgeInput();
        this.residentInputBytes = 0;
        if (this.projection?.table && this.tableScroller) {
          this.setTableViewTarget(this.selection.head, this.selection.table?.head);
          this.revealTableCaret();
        }
      }
    } catch (error) {
      // Unacknowledged intent remains in the backing inbox for inspection/recovery.
      this.error = String(error);
    } finally {
      this.replayingInput = false;
      this.replayTime = undefined;
      this.residentInputBytes = 0;
      this.drainingInput = false;
      this.checkTableCoverage();
      this.changed();
    }
  }
  private tableTabAtEnd = false;
  private tableTabDestination?: Selection;
  tableViewport = 0;
  private tableScroller?: HTMLElement;
  private tableScrollRequest?: {
    position: number;
    top: number;
    left: number;
    minimum?: { cell: number; units: number; blocks?: { from: number; to: number } };
  };
  private tableCoverageRequest?: typeof this.tableScrollRequest;
  // Numeric viewport intent, distinct from durable selection. A physical scroll
  // or newer document/selection invalidates it; no source or old editor is kept.
  private tableViewTarget?: TableViewTarget;
  private tableTargetCandidate?: TableViewTarget;
  private maxTableIntentAdmissionBytes = 0;
  private tableCoverageState?: TableCoverageState;
  private tableCoverageFailure?: TableCoverageState;
  private currentTableTarget() {
    const target = this.tableViewTarget;
    if (
      target &&
      (target.revision !== this.service.revision ||
        target.generation !== this.selectionGeneration ||
        target.navigation !== this.navigation)
    )
      this.tableViewTarget = undefined;
    return this.tableViewTarget;
  }
  private stageTableViewTarget(position: number, point?: TablePoint) {
    if (!this.host.parentElement?.clientHeight) return;
    this.tableTargetCandidate = {
      position,
      ...(point ? { point: { ...point } } : {}),
      revision: this.service.revision,
      generation: this.selectionGeneration,
      navigation: this.navigation,
    };
    try {
      this.checkTableIntentBudget();
    } catch (error) {
      this.tableTargetCandidate = undefined;
      throw error;
    }
  }
  private publishTableViewTarget() {
    this.tableViewTarget = this.tableTargetCandidate;
    this.tableTargetCandidate = undefined;
    this.tableCoverageFailure = undefined;
  }
  private setTableViewTarget(position: number, point?: TablePoint) {
    this.stageTableViewTarget(position, point);
    this.publishTableViewTarget();
  }
  private tableFragmentScrollTop = 0;
  private tableAnchoredScroll?: { left: number; top: number };
  private tableFont() {
    const style = getComputedStyle(this.editor?.view.dom ?? this.host);
    return [style.fontFamily, style.fontSize, style.lineHeight, style.letterSpacing].join('|');
  }
  private tableResize?: ResizeObserver;
  private tableMeasurements?: ResizeObserver;
  private measuredTable?: Element;
  private tableFontObserver?: MutationObserver;
  private tableAnchor?: { point: string; left: number; top: number };
  private tableOriginX = 0;
  private tableOriginY = 0;
  private rememberTableAnchor() {
    const editor = this.editor;
    if (!editor || !this.selection.table) return;
    try {
      const coords = editor.view.coordsAtPos(editor.state.selection.head);
      this.tableAnchor = {
        point: JSON.stringify(this.selection.table.head),
        left: coords.left,
        top: coords.top,
      };
    } catch {
      this.tableAnchor = undefined;
    }
  }
  private preserveTableAnchor(before: { left: number; top: number }) {
    const editor = this.editor,
      scroller = this.tableScroller ?? this.host.parentElement;
    if (!editor || !scroller) return;
    let after = editor.view.coordsAtPos(editor.state.selection.head);
    scroller.scrollLeft += after.left - before.left;
    scroller.scrollTop += after.top - before.top;
    after = editor.view.coordsAtPos(editor.state.selection.head);
    // At the document origin negative scrolling is impossible. A bounded scalar
    // inset preserves the screen anchor without retaining or measuring hidden cells.
    this.tableOriginX = Math.max(0, this.tableOriginX + before.left - after.left);
    this.tableOriginY = Math.max(0, this.tableOriginY + before.top - after.top);
    editor.view.dom.style.paddingLeft = `${this.tableOriginX}px`;
    // Keep the content box constant as the inset grows: the native wrapper is
    // centered within it, so changing padding alone applies only half the offset.
    editor.view.dom.style.width = `${this.projection!.table!.window.columns * this.tableColumnWidth + this.tableOriginX + this.tableViewport}px`;
    editor.view.dom.style.paddingTop = `${(this.projection!.table!.window.geometry?.top ?? 0) + this.tableOriginY}px`;
    this.tableAnchoredScroll = { left: scroller.scrollLeft, top: scroller.scrollTop };
  }
  private tableCoverageBusy = false;
  private tableCoverageRescan = false;
  private tableCoverageQueued = false;
  tableCoverage = { status: 'unmeasured', attempts: 0, deficit: 0, sourceUnits: 0 };
  private measuredTableGap() {
    const p = this.projection,
      editor = this.editor,
      scroller = this.tableScroller;
    if (!p?.table || !editor || !scroller || !scroller.clientHeight) return undefined;
    const viewport = scroller.getBoundingClientRect();
    for (const entry of p.table.entries) {
      const c = entry.cell;
      if (c.first === c.body && c.last === c.end) continue;
      const cell = editor.view.nodeDOM(entry.pm) as HTMLElement;
      const box = cell.getBoundingClientRect();
      if (
        box.right <= viewport.left ||
        box.left >= viewport.right ||
        box.bottom <= viewport.top ||
        box.top >= viewport.top + scroller.clientHeight
      )
        continue;
      const paragraphs = Array.from(cell.querySelectorAll('p'));
      const first = paragraphs[0]?.getBoundingClientRect(),
        last = paragraphs.at(-1)?.getBoundingClientRect();
      if (!first || !last || last.bottom <= first.top) continue;
      const layout = p.table.window.layout?.find((l) => l.cell === c.from);
      const style = getComputedStyle(cell);
      const top = Math.max(
        viewport.top,
        box.top + parseFloat(style.paddingTop) - (layout?.top ?? 0),
      );
      const bottom = Math.min(
        viewport.top + scroller.clientHeight,
        box.bottom - parseFloat(style.paddingBottom) + (layout?.bottom ?? 0),
      );
      const above = c.first > c.body ? Math.max(0, first.top - top) : 0,
        below = c.last < c.end ? Math.max(0, bottom - last.bottom) : 0;
      const deficit = above + below;
      const blockHeight = (last.bottom - first.top) / paragraphs.length;
      const blocks =
        c.blocks && c.blocks.length > 1
          ? {
              from: Math.max(0, c.blocks[0].index - Math.ceil(above / blockHeight)),
              to: Math.min(
                c.blockCount!,
                c.blocks.at(-1)!.index + 1 + Math.ceil(below / blockHeight),
              ),
            }
          : undefined;
      if (deficit > 1)
        return {
          cell: c.from,
          units: c.last - c.first,
          height: last.bottom - first.top,
          required: bottom - top,
          deficit,
          position: c.body,
          first: c.first,
          last: c.last,
          ...(blocks ? { blocks } : {}),
        };
    }
    return undefined;
  }
  private measureTableCoverageState(): TableCoverageState | undefined {
    const gap = this.measuredTableGap();
    if (!gap) return undefined;
    const scroller = this.tableScroller!,
      target = this.currentTableTarget();
    return {
      ...gap,
      revision: this.service.revision,
      generation: this.selectionGeneration,
      top: scroller.scrollTop,
      left: scroller.scrollLeft,
      width: scroller.clientWidth,
      viewportHeight: scroller.clientHeight,
      font: this.tableFont(),
      ...(target ? { target: target.position, point: target.point } : {}),
    };
  }
  /** Only the current mounted rectangles decide coverage. Refills retain no owner. */
  private checkTableCoverage() {
    if (
      this.tableCoverageQueued ||
      this.tableCoverageBusy ||
      !this.projection?.tableSource ||
      this.pointerSelecting ||
      this.drainingInput ||
      this.editor?.view.composing
    )
      return;
    this.tableCoverageQueued = true;
    const navigation = this.navigation,
      revision = this.service.revision,
      generation = this.selectionGeneration;
    queueMicrotask(() => {
      this.tableCoverageQueued = false;
      if (
        this.navigation !== navigation ||
        this.service.revision !== revision ||
        this.selectionGeneration !== generation ||
        !this.editor ||
        this.editor.view.composing ||
        this.pointerSelecting ||
        this.drainingInput ||
        this.tableScrollRequest
      )
        return;
      void this.fillTableCoverage(navigation, revision, generation);
    });
  }
  private async fillTableCoverage(navigation: number, revision: number, generation: number) {
    this.tableCoverageBusy = true;
    let request: typeof this.tableScrollRequest;
    try {
      let previousUnits = 0,
        previousDeficit = Infinity;
      for (let attempt = 0; attempt <= 4; attempt++) {
        if (
          !this.editor ||
          this.navigation !== navigation ||
          this.service.revision !== revision ||
          this.selectionGeneration !== generation ||
          this.editor.view.composing ||
          this.pointerSelecting ||
          this.drainingInput
        )
          return;
        const gap = this.measureTableCoverageState();
        if (gap) {
          this.tableCoverageState = gap;
          try {
            this.checkTableIntentBudget();
          } catch (error) {
            this.tableCoverageState = undefined;
            throw error;
          }
          // Observer callbacks may repeat after a failed refill. Own navigation
          // increments are not progress; retry only for a changed measured state.
          if (
            this.tableCoverageFailure &&
            JSON.stringify(this.tableCoverageFailure) === JSON.stringify(this.tableCoverageState)
          )
            return;
        }
        this.tableCoverageFailure = undefined;
        this.tableCoverage = {
          status: gap ? 'uncovered' : 'covered',
          attempts: attempt,
          deficit: gap?.deficit ?? 0,
          sourceUnits: gap?.units ?? 0,
        };
        if (!gap) return;
        if (attempt === 4 || (gap.units <= previousUnits && gap.deficit >= previousDeficit - 1))
          throw new Error('Table viewport uncovered: no strictly progressing bounded refill');
        previousUnits = gap.units;
        previousDeficit = gap.deficit;
        const scroller = this.tableScroller!;
        request = {
          position: this.currentTableTarget()?.position ?? gap.position,
          top: Math.max(0, scroller.scrollTop - this.tableOriginY),
          left: Math.max(0, scroller.scrollLeft - this.tableOriginX),
          minimum: {
            cell: gap.cell,
            ...(gap.blocks ? { blocks: gap.blocks } : {}),
            units: Math.min(
              8192,
              Math.ceil(gap.units * Math.max(1, (gap.required + 24) / gap.height)),
            ),
          },
        };
        this.tableScrollRequest = request;
        this.tableCoverageRequest = request;
        this.checkTableIntentBudget();
        // show has its own revision/navigation/selection guards across delayFetch.
        const pending = this.show(
          this.active,
          false,
          request.position,
          false,
          undefined,
          undefined,
          undefined,
          request,
        );
        navigation = this.navigation;
        if (!(await pending)) return;
        if (this.tableScrollRequest === request) this.tableScrollRequest = undefined;
        const top = scroller.scrollTop,
          left = scroller.scrollLeft;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (scroller.scrollTop !== top || scroller.scrollLeft !== left) return;
      }
    } catch (error) {
      if (
        this.editor &&
        this.navigation === navigation &&
        this.service.revision === revision &&
        this.selectionGeneration === generation
      ) {
        this.error = String(error);
        this.tableCoverageFailure = this.tableCoverageState;
        this.tableCoverage.status = 'uncovered';
        this.changed();
      }
    } finally {
      if (this.tableScrollRequest === request) this.tableScrollRequest = undefined;
      this.tableCoverageRequest = undefined;
      this.tableCoverageState = undefined;
      this.currentTableTarget();
      this.tableCoverageBusy = false;
      if (this.tableCoverageRescan) {
        this.tableCoverageRescan = false;
        this.checkTableCoverage();
      }
    }
  }
  private tableScroll = () => {
    const scroller = this.tableScroller;
    const anchored = this.tableAnchoredScroll;
    if (scroller && anchored?.left === scroller.scrollLeft && anchored.top === scroller.scrollTop) {
      this.tableFragmentScrollTop = scroller.scrollTop;
      return;
    }
    this.tableAnchoredScroll = undefined;
    this.tableViewTarget = undefined;
    this.tableCoverageFailure = undefined;
    if (this.tableCoverageBusy && this.pendingFetch) {
      // A physical scroll during a delayed refill supersedes that request.
      this.navigation++;
      this.pendingNavigation?.(false);
      this.pendingNavigation = undefined;
      this.tableScrollRequest = undefined;
      this.tableCoverage.status = 'unmeasured';
      this.tableCoverageRescan = true;
      // Fall through now: install the latest navigation before the shared fetch
      // resolves. Requiring another scroll would strand the visible viewport.
    }
    const table = this.projection?.table?.window;
    if (!table || !scroller || !this.tableColumnWidth || this.editor?.view.composing) return;
    const key = {
      revision: this.service.revision,
      table: table.from,
      width: this.tableColumnWidth,
      font: this.tableFont(),
    };
    const geometry = this.service.tableHeights.viewport(
      key,
      table.rows,
      Math.max(0, scroller.scrollTop - this.tableOriginY),
      scroller.clientHeight,
    );
    const row = geometry.row;
    const column = Math.max(
      0,
      Math.min(
        table.columns - 1,
        Math.floor(Math.max(0, scroller.scrollLeft - this.tableOriginX) / this.tableColumnWidth),
      ),
    );
    const lastRow = Math.min(table.rows - 1, row + geometry.heights.length - 1);
    const lastColumn = Math.min(
      table.columns - 1,
      Math.floor(
        (Math.max(0, scroller.scrollLeft - this.tableOriginX) + scroller.clientWidth - 1) /
          this.tableColumnWidth,
      ),
    );
    const fragmentMove =
      table.cells.some((c) => c.first > c.body || c.last < c.end) &&
      Math.abs(scroller.scrollTop - this.tableFragmentScrollTop) >
        Math.max(24, scroller.clientHeight / 4);
    if (
      !fragmentMove &&
      [row, lastRow].every((r) =>
        [column, lastColumn].every((c) =>
          table.cells.some(
            (cell) => cell.row === r && cell.column <= c && cell.column + (cell.span ?? 1) > c,
          ),
        ),
      )
    ) {
      this.rememberTableAnchor();
      return;
    }
    const atEnd = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1;
    this.tableFragmentScrollTop = scroller.scrollTop;
    const at = this.service.tableAddress(table.from, row, column);
    const request = (this.tableScrollRequest = {
      position: at.source,
      top: Math.max(0, scroller.scrollTop - this.tableOriginY),
      left: Math.max(0, scroller.scrollLeft - this.tableOriginX),
    });
    const active = this.projection!.table!.entries.find(
      (e) => e.cell.from === this.selection.table?.head.cell,
    )?.cell;
    const preserve =
      this.pointerSelecting ||
      (!!active &&
        active.row >= row &&
        active.row <= lastRow &&
        active.column >= column &&
        active.column <= lastColumn);
    void this.show(this.active, false, at.source, preserve && !fragmentMove).finally(() => {
      if (this.tableScrollRequest !== request) return;
      this.tableScrollRequest = undefined;
      if (atEnd && this.projection?.table)
        scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
      this.tableFragmentScrollTop = scroller.scrollTop;
      this.checkTableCoverage();
    });
  };
  tableColumnWidth = 0;
  resizeTable(viewport: number, anchor = true) {
    const editor = this.editor,
      table = this.projection?.table;
    if (!editor || !table) return;
    const scroller = this.host.parentElement;
    let before: { left: number; top: number } | undefined;
    if (anchor && scroller)
      try {
        const geometry = table.window.geometry;
        const cached = this.tableAnchor;
        before =
          geometry &&
          cached &&
          cached.point === JSON.stringify(this.selection.table?.head) &&
          (geometry.font !== this.tableFont() || Math.abs(viewport - this.tableViewport) > 1)
            ? cached
            : editor.view.coordsAtPos(editor.state.selection.head);
      } catch {
        before = undefined;
      }
    this.tableViewport = viewport || scroller?.clientWidth || 640;
    if (table.window.geometry && !this.pointerSelecting) {
      const current = table.window.geometry;
      const key = {
        revision: this.service.revision,
        table: table.window.from,
        width: Math.max(160, Math.floor(this.tableViewport / Math.min(3, table.window.columns))),
        font: this.tableFont(),
      };
      table.window.geometry = this.service.tableHeights.range(
        key,
        table.window.rows,
        current.row,
        current.heights.length,
      );
      editor.view.setProps({});
    }
    this.tableColumnWidth = layoutTable(editor, table.window, this.tableViewport).width;
    const fragment =
      !anchor && this.tableScrollRequest && !this.drainingInput
        ? table.entries.find((entry) => entry.cell.first > entry.cell.body)
        : undefined;
    const fragmentTop = () =>
      fragment &&
      (editor.view.nodeDOM(fragment.pm) as HTMLElement).querySelector('p')?.getBoundingClientRect()
        .top;
    const beforeFragmentTop = fragmentTop();
    const beforeFragmentScroll = scroller?.scrollTop ?? 0;
    if (table.window.geometry && !this.pointerSelecting) {
      const rows = Array.from(
        editor.view.dom.querySelectorAll('tr'),
        (row) => row.getBoundingClientRect().height,
      );
      if (rows.every((height) => height > 0)) {
        table.window.geometry = this.service.tableHeights.record(table.window.geometry, rows);
        if (table.window.cells.some((c) => c.first > c.body || c.last < c.end)) {
          const measured = table.entries.map((entry) => {
            const cell = editor.view.nodeDOM(entry.pm) as HTMLElement;
            const paragraphs = Array.from(cell.querySelectorAll('p'));
            const first = paragraphs[0]?.getBoundingClientRect(),
              last = paragraphs.at(-1)?.getBoundingClientRect();
            const style = getComputedStyle(cell),
              layout = table.window.layout?.find((l) => l.cell === entry.cell.from);
            return {
              cell: entry.cell.from,
              height: first && last ? last.bottom - first.top : 0,
              padding:
                parseFloat(style.paddingTop) +
                parseFloat(style.paddingBottom) -
                (layout?.top ?? 0) -
                (layout?.bottom ?? 0) +
                1,
            };
          });
          this.service.tableHeights.measureCells(table.window, measured);
        }
        editor.view.setProps({});
        layoutTable(editor, table.window, this.tableViewport);
        const size =
          this.projection!.sourcePayloadBytes +
          bytes(JSON.stringify(this.projection!.context)) +
          this.tableIntentBytes;
        if (size > TABLE_ACTIVE_BYTES)
          throw new Error('Measured table context exceeds source budget');
        this.maxSourceContextBytes = Math.max(this.maxSourceContextBytes, size);
      }
    }
    editor.view.dom.style.paddingLeft = `${this.tableOriginX}px`;
    editor.view.dom.style.paddingTop = `${(table.window.geometry?.top ?? table.window.cells[0].row * 41) + this.tableOriginY}px`;
    editor.view.dom.style.paddingBottom = table.window.cells.some(
      (c) => c.first > c.body || c.last < c.end,
    )
      ? '0px'
      : `${scroller?.clientHeight ?? 0}px`;
    editor.view.dom.style.paddingRight = `${this.tableViewport}px`;
    editor.view.dom.style.width = `${table.window.columns * this.tableColumnWidth + this.tableOriginX + this.tableViewport}px`;
    const afterFragmentTop = fragmentTop();
    if (
      this.tableScrollRequest &&
      beforeFragmentTop !== undefined &&
      afterFragmentTop !== undefined
    ) {
      // Keep the encountered fragment at the user's requested pixel position as
      // measured text replaces its estimated height. Retaining the old absolute
      // scroll offset can otherwise leave the admitted text outside the viewport.
      this.tableScrollRequest.top = Math.max(
        0,
        this.tableScrollRequest.top +
          afterFragmentTop +
          (scroller?.scrollTop ?? 0) -
          beforeFragmentTop -
          beforeFragmentScroll,
      );
    }
    const nativeTable = editor.view.dom.querySelector('table');
    if (
      nativeTable &&
      nativeTable !== this.measuredTable &&
      typeof ResizeObserver !== 'undefined'
    ) {
      this.tableMeasurements?.disconnect();
      this.measuredTable = nativeTable;
      this.tableMeasurements = new ResizeObserver(() => {
        if (!this.pointerSelecting && !editor.isDestroyed && this.editor === editor)
          this.resizeTable(this.tableViewport);
      });
      this.tableMeasurements.observe(nativeTable);
      this.tableFontObserver?.disconnect();
      let observedFont = this.tableFont();
      this.tableFontObserver = new MutationObserver(() => {
        if (this.pointerSelecting || editor.isDestroyed || this.editor !== editor) return;
        const font = this.tableFont();
        if (font !== observedFont) {
          // Remember the font before layout writes observed style attributes.
          observedFont = font;
          this.resizeTable(this.tableViewport);
        }
      });
      this.tableFontObserver.observe(editor.view.dom, {
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }
    if (before && scroller) this.preserveTableAnchor(before);
    this.checkTableCoverage();
    this.rememberTableAnchor();
    if (scroller && !this.tableScroller) {
      this.tableScroller = scroller;
      scroller.addEventListener('scroll', this.tableScroll);
      if (typeof ResizeObserver !== 'undefined') {
        this.tableResize = new ResizeObserver((entries) => {
          const width = entries[0]?.contentRect.width;
          if (width && Math.abs(width - this.tableViewport) > 1) this.resizeTable(width);
        });
        this.tableResize.observe(scroller);
      }
    }
  }
  private continueNearEdge(afterEdit = false) {
    if (
      this.drainingInput ||
      !this.continuation ||
      this.continuationQueued ||
      !this.editor ||
      this.editor.view.composing
    )
      return;
    const p = this.projection!,
      head = this.selection.head;
    if (p.table) {
      const cell = p.table.entries.find(
        (e) => e.cell.from === this.selection.table?.head.cell,
      )?.cell;
      const point = this.selection.table?.head;
      const mounted = point && p.table.pointAt(p.table.pointPM(point) ?? -1);
      // A scrolled viewport may retain an offscreen durable caret. Its clamped
      // mounted fallback is not a gesture approaching a continuation boundary.
      if (!point || !mounted || mounted.offset !== point.offset || mounted.block !== point.block)
        return;
      // Measured coverage can require more than the estimated paragraph count.
      // Repage only near its actual boundary; character margins are meaningful
      // for a single text block, not between several short native paragraphs.
      const pageBlocks =
        cell?.blocks &&
        point &&
        ((point.block - cell.blocks[0].index < 2 && cell.blocks[0].index > 0) ||
          (cell.blocks.at(-1)!.index - point.block < 2 &&
            cell.blocks.at(-1)!.index + 1 < (cell.blockCount ?? 0)) ||
          (afterEdit && cell.blocks.length > 8));
      const pageText =
        cell &&
        (!cell.blocks || cell.blocks.length <= 1) &&
        ((cell.first > cell.body && head - cell.first < 32) ||
          (cell.last < cell.end && cell.last - head < 32));
      if (!pageBlocks && !pageText) return;
      this.continuationQueued = true;
      const navigation = this.navigation;
      queueMicrotask(() => {
        this.continuationQueued = false;
        if (this.navigation === navigation && this.editor && !this.editor.view.composing)
          void this.show(this.active, true, this.selection.head, true);
      });
      return;
    }
    if (head < p.start || head > this.windowEnd) return;
    const first = this.service.start(this.active),
      last = this.service.start(this.active + 1);
    if (!(
      (p.start > first && head < p.start + CONTINUATION.margin) ||
      (this.windowEnd < last && head > this.windowEnd - CONTINUATION.margin)
    ))
      return;
    this.continuationQueued = true;
    const navigation = this.navigation;
    queueMicrotask(() => {
      this.continuationQueued = false;
      if (
        this.navigation !== navigation ||
        this.drainingInput ||
        !this.editor ||
        this.editor.view.composing
      )
        return;
      void this.show(this.active, true, this.selection.head, true);
    });
  }
  async show(
    id: number,
    restore = false,
    position?: number,
    preserveView = false,
    requestedSelection?: Selection,
    anchorPoint: TablePoint | undefined = this.selection.table?.head,
    boundaryAnchor?: number,
    coverageRequest?: typeof this.tableScrollRequest,
  ) {
    if (this.editor?.view.composing) {
      this.error = 'Composition pins current view';
      this.changed();
      return false;
    }
    const ticket = this.navigation + 1;
    if (
      !restore &&
      this.currentTableTarget() &&
      coverageRequest &&
      coverageRequest === this.tableCoverageRequest &&
      this.tableScrollRequest === this.tableCoverageRequest &&
      this.tableCoverageRequest
    )
      this.tableViewTarget!.navigation = ticket;
    else {
      this.tableViewTarget = undefined;
      this.tableCoverageFailure = undefined;
    }
    this.navigation = ticket;
    const revision = this.service.revision;
    const selectionGeneration = this.selectionGeneration;
    // One shared pending request, with latest navigation winning before any payload is captured.
    if (this.delayFetch) {
      this.pendingNavigation?.(false);
      const ready = new Promise<boolean>((resolve) => {
        this.pendingNavigation = resolve;
      });
      this.pendingFetch ??= this.delayFetch().then(
        () => {
          this.pendingFetch = undefined;
          const resolve = this.pendingNavigation;
          this.pendingNavigation = undefined;
          resolve?.(true);
        },
        (error) => {
          this.pendingFetch = undefined;
          this.error = String(error);
          this.pendingNavigation?.(false);
          this.pendingNavigation = undefined;
        },
      );
      if (!(await ready)) return false;
    }
    if (
      ticket !== this.navigation ||
      revision !== this.service.revision ||
      selectionGeneration !== this.selectionGeneration ||
      (this.pointerSelecting && !preserveView) ||
      this.editor?.view.composing
    ) {
      this.error = 'Stale or composing view pinned';
      this.changed();
      return false;
    }
    const window = this.readWindow(id, position, requestedSelection, boundaryAnchor);
    let shown = false;
    try {
      if (restore && window.table && position !== undefined)
        this.stageTableViewTarget(
          position,
          position === (requestedSelection ?? this.selection).head
            ? (requestedSelection ?? this.selection).table?.head
            : undefined,
        );
      const next = this.project(
        window.source,
        window.from,
        window.table,
        'fragments' in window ? window.fragments : undefined,
      );
      if (next.table || next.mixed) {
        try {
          if (next.mixed) MixedProjection.nodeBudget(next.content);
          else tableNodeBudget(next.content);
        } catch (error) {
          this.error = String(error);
          this.changed();
          return false;
        }
      }
      if (restore) this.publishTableViewTarget();
      if (preserveView && this.editor) {
        if (this.pointerSelecting) this.pointerRemapped = true;
        // Keep Chromium's active keyboard or mouse gesture on the same focused view.
        // Only the bounded projection is replaced; durable source/history are untouched.
        const editor = this.editor;
        let scroller = this.host.parentElement;
        while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
          scroller = scroller.parentElement;
        const before = scroller ? editor.view.coordsAtPos(editor.state.selection.head) : undefined;
        this.projection = next;
        this.windowEnd = window.to;
        void this.loadAnnotations();
        this.suppress = true;
        try {
          const tr = editor.state.tr.replaceWith(
            0,
            editor.state.doc.content.size,
            editor.schema.nodeFromJSON(next.content).content,
          );
          const restored = requestedSelection ?? this.selection;
          tr.setSelection(
            next.restoreNodeSelection(tr.doc, restored) ??
              next.mixed?.restoreSelection(tr.doc, restored) ??
              next.table?.restoreSelection(tr.doc, restored) ??
              TextSelection.create(
                tr.doc,
                next.table?.pointPM(this.selection.table?.anchor) ??
                  next.pmAt(this.selection.anchor, this.selection.affinity),
                next.table?.pointPM(this.selection.table?.head) ??
                  next.pmAt(this.selection.head, this.selection.affinity),
              ),
          );
          if (this.pointerSelecting && next.table && tr.selection instanceof CellSelection)
            tr.setMeta(tableEditingKey, tr.selection.$anchorCell.pos);
          editor.view.dispatch(tr.setMeta('addToHistory', false));
          // Anchor layout to the requested logical endpoint, not the old
          // selection's fallback position in a newly admitted rectangle.
          if (requestedSelection) this.selection = requestedSelection;
        } finally {
          this.suppress = false;
        }
        this.resizeTable(this.tableViewport, false);
        if (scroller && before) {
          if (next.table) this.preserveTableAnchor(before);
          else
            scroller.scrollTop +=
              editor.view.coordsAtPos(editor.state.selection.head).top - before.top;
        }
        this.rememberTableAnchor();
        this.error = '';
        this.changed();
        shown = true;
        return true;
      }
      // Reconstructing a row is not a request to scroll to its origin: one row
      // can contain many viewports of text. Keep only the encountered caret's
      // pixel coordinate while the old native view is still available.
      let restoreAnchor: { left: number; top: number } | undefined;
      let restoreViewport: { left: number; top: number } | undefined;
      if (restore && next.table && this.projection?.table && this.editor) {
        const scroller = this.tableScroller ?? this.host.parentElement;
        const viewport = scroller?.getBoundingClientRect();
        if (scroller && viewport && scroller.clientHeight > 0) {
          restoreViewport = { left: scroller.scrollLeft, top: scroller.scrollTop };
          const actual = this.projection.table.pointAt(this.editor.state.selection.head);
          // Detached or non-layout hosts have no encountered pixel anchor.
          // Do not ask native text geometry to measure an invisible viewport.
          if (actual && JSON.stringify(actual) === JSON.stringify(anchorPoint)) {
            const caret = this.editor.view.coordsAtPos(this.editor.state.selection.head);
            if (
              caret.top >= viewport.top &&
              caret.bottom <= viewport.top + scroller.clientHeight &&
              caret.left >= viewport.left &&
              caret.right <= viewport.left + scroller.clientWidth
            )
              restoreAnchor = { left: caret.left, top: caret.top };
          }
        }
      }
      if (restoreViewport) {
        const anchorBytes = bytes(JSON.stringify({ restoreAnchor, restoreViewport, anchorPoint }));
        const activeBytes =
          sourcePayloadBytes(window.source) +
          bytes(JSON.stringify(next.context)) +
          anchorBytes +
          this.tableIntentBytes;
        if (activeBytes > TABLE_ACTIVE_BYTES)
          throw new Error('Table restoration anchor exceeds source budget');
        this.maxSourceContextBytes = Math.max(this.maxSourceContextBytes, activeBytes);
        this.maxTableRestoreAnchorBytes = Math.max(this.maxTableRestoreAnchorBytes, anchorBytes);
        this.maxTableResidentAndAssemblyBytes = Math.max(
          this.maxTableResidentAndAssemblyBytes,
          activeBytes +
            this.projection!.sourcePayloadBytes +
            bytes(JSON.stringify(this.projection!.context)),
        );
      }
      this.editor?.destroy();
      if (this.editor) this.destroyed++;
      this.active = id;
      this.windowEnd = window.to;
      this.continuation = window.continuation;
      this.projection = next;
      void this.loadAnnotations();
      const decorations = (state: EditorState) => {
        const p = this.projection!;
        const ranges = this.annotationRanges(p);
        const page = this.annotationPage;
        const result =
          page &&
          this.annotationRange === JSON.stringify(ranges) &&
          page.revision === this.service.revision &&
          page.generation === this.service.generation &&
          page.commentRevision === this.service.commentRevision
            ? page
            : { items: [] };
        const rows: Decoration[] = [];
        if (p.table?.window.geometry && state.doc.firstChild?.type.name === 'table') {
          const heights = p.table.window.geometry.heights;
          state.doc.firstChild.forEach((row, offset, index) => {
            if (heights[index] !== undefined)
              rows.push(
                Decoration.node(offset + 1, offset + 1 + row.nodeSize, {
                  style: `height:${heights[index]}px`,
                }),
              );
          });
        }
        return DecorationSet.create(state.doc, [
          ...rows,
          ...(p.table?.window.layout ?? []).flatMap((layout) => {
            const entry = p.table!.entries.find((e) => e.cell.from === layout.cell);
            const node = entry && state.doc.nodeAt(entry.pm);
            return node
              ? [
                  Decoration.node(entry!.pm, entry!.pm + node.nodeSize, {
                    'data-proof-cell-fragment': 'true',
                    style: `--proof-cell-before:${layout.top}px;--proof-cell-after:${layout.bottom}px`,
                  }),
                ]
              : [];
          }),
          ...(p.list?.synthetic ?? []).map((pos) =>
            Decoration.node(pos, pos + 2, { style: 'display:none', contenteditable: 'false' }),
          ),
          ...(p.list?.entries.filter((e) => !e.part) ?? []).map((e) =>
            Decoration.node(e.pm, e.pm + state.doc.nodeAt(e.pm)!.nodeSize, {
              class: 'proof-synthetic-list-item',
              style: 'list-style-type:none',
            }),
          ),
          ...result.items.flatMap((a) =>
            ranges.flatMap((range) => {
              if (a.from >= range.to || a.to <= range.from) return [];
              const from = p.pmAt(Math.max(a.from, range.from)),
                to = p.pmAt(Math.min(a.to, range.to), -1);
              return from < to
                ? [
                    Decoration.inline(
                      from,
                      to,
                      a.kind === 'attribution'
                        ? { nodeName: 'span', 'data-proof-attribution': a.id }
                        : { nodeName: 'span', 'data-proof-comment': a.id },
                    ),
                  ]
                : [];
            }),
          ),
        ]);
      };
      const annotations = Extension.create({
        name: 'sourceAnchoredProof',
        addProseMirrorPlugins() {
          return [new Plugin({ props: { decorations } })];
        },
      });
      const config = createEditorConfig({
        element: this.host,
        content: '',
        editable: true,
        useMarkdown: true,
        enableComments: false,
        enableMentions: false,
        onUpdate: () => {},
      });
      // Keep the native highlighter; meter its actual input, including auto detection.
      const splitLogicalCell = (props: CommandProps): boolean | undefined => {
        const p = this.projection?.table;
        if (!p) return undefined;
        const logical = this.fromPM(props.state.selection).table;
        const entry = p?.entries.find((e) => e.cell.from === logical?.anchor.cell);
        if (
          !entry?.cell.owner ||
          !entry.cell.mounted ||
          (entry.cell.owner.rowspan === entry.cell.mounted.rowspan &&
            entry.cell.owner.colspan === entry.cell.mounted.colspan)
        )
          return undefined;
        if (logical!.anchor.cell !== logical!.head.cell) return false;
        if (props.dispatch)
          props.tr.setMeta('proofLogicalTableSplit', {
            revision: this.service.revision,
            table: p!.window.from,
            cell: entry.cell.from,
          });
        return true;
      };
      const extensions = config.extensions.map((ext) => {
        const logicalCommand = (
          name: TableCommandName,
          props: CommandProps,
        ): boolean | undefined => {
          const logical = this.selection.table,
            p =
              this.projection?.table ??
              this.projection?.mixed?.parts.find((part) => {
                const table = part.projection.table?.window;
                return (
                  table &&
                  logical &&
                  logical.anchor.cell >= table.from &&
                  logical.anchor.cell < table.to
                );
              })?.projection.table;
          if (!p || !logical) return undefined;
          const window = p.window;
          const complete =
            window.cells.every((c) => !c.owner && !c.partial) &&
            window.cells.length === window.rows * window.columns;
          const header = window.cells.some(
            (c) => c.row === 0 && (c.from === logical.anchor.cell || c.from === logical.head.cell),
          );
          if (
            complete &&
            name !== 'deleteTable' &&
            !(header && ['addRowBefore', 'deleteRow', 'mergeCells', 'mergeOrSplit'].includes(name))
          )
            return undefined;
          const intent = {
            revision: this.service.revision,
            table: window.from,
            command: name,
            selection: structuredClone(this.selection),
          };
          if (!this.service.stageLogicalTableCommand(intent, this.editor!, false, !!props.dispatch))
            return false;
          if (props.dispatch) props.tr.setMeta('proofLogicalTableCommand', intent);
          return true;
        };
        if (ext.name === 'table')
          return ext
            .extend({
              addCommands() {
                const parent = this.parent!();
                return {
                  ...parent,
                  ...Object.fromEntries(
                    tableCommands
                      .filter((name) => name !== 'splitCell')
                      .map((name) => [
                        name,
                        () => (props: CommandProps) =>
                          logicalCommand(name, props) ?? parent[name]!()(props),
                      ]),
                  ),
                  splitCell: () => (props) => splitLogicalCell(props) ?? parent.splitCell!()(props),
                };
              },
            })
            .configure(ext.options);

        if (ext.name === 'starterKit') return ext.configure({ ...ext.options, undoRedo: false });
        if (ext.name !== 'codeBlock') return ext;
        const lowlight = ext.options.lowlight;
        const measured = new Proxy(lowlight, {
          get: (target, key) => {
            const value = Reflect.get(target, key);
            if (key !== 'highlight' && key !== 'highlightAuto') return value;
            return (...args: unknown[]) => {
              const source = String(args[key === 'highlight' ? 1 : 0]);
              this.maxHighlightBytes = Math.max(this.maxHighlightBytes, bytes(source));
              this.highlightCalls++;
              return value.apply(target, args);
            };
          },
        });
        return ext.configure({ ...ext.options, lowlight: measured });
      });
      this.suppress = true;
      this.editor = new Editor({
        ...config,
        content: this.projection.content,
        extensions: [...extensions, CommentAnchor, annotations],
        onUpdate: () => {},
        onSelectionUpdate: () => {},
        onTransaction: ({ transaction, appendedTransactions }) =>
          this.accept([transaction, ...(appendedTransactions ?? [])]),
        editorProps: {
          ...config.editorProps,
          createSelectionBetween: (view, anchor, head) => this.fromDOMBoundary(view, anchor, head),
          handleDOMEvents: {
            ...config.editorProps?.handleDOMEvents,
            paste: (_view, event) => {
              if (!this.selection.table || !this.clipboardInput) return false;
              event.preventDefault();
              try {
                this.pasteTableSelection();
                this.error = '';
              } catch (error) {
                this.error = String(error);
              }
              return true;
            },
            copy: (_view, event) => {
              if (this.selection.table?.kind !== 'cell') return false;
              event.preventDefault();
              try {
                this.copyTableSelection();
                this.error = '';
              } catch (error) {
                this.error = String(error);
              }
              return true;
            },
            cut: (_view, event) => {
              if (this.selection.table?.kind !== 'cell') return false;
              event.preventDefault();
              try {
                this.cutTableSelection();
                this.error = '';
              } catch (error) {
                this.error = String(error);
              }
              return true;
            },
            beforeinput: (_view, event) => {
              if (this.replayingInput || !event.cancelable) return false;
              const p = this.projection!;
              const needsWindow =
                (p.list || p.table) &&
                event.inputType === 'insertText' &&
                (bytes(event.data ?? '') > 128 ||
                  p.sourcePayloadBytes +
                    bytes(JSON.stringify(p.context)) +
                    2 * bytes(event.data ?? '') >
                    LIMITS.request - 128);
              if (!this.service.pendingInputs && !needsWindow && !(p.table && this.pendingFetch))
                return false;
              const commands: Record<string, string> = {
                insertText: 'insertText',
                insertParagraph: 'insertParagraph',
                deleteContentBackward: 'delete',
                deleteContentForward: 'forwardDelete',
              };
              const command = commands[event.inputType];
              if (!command) return false;
              event.preventDefault();
              this.deferInput(command, event.data ?? undefined);
              return true;
            },
          },
          handleKeyDown: (_view, event) => {
            this.mixedKey =
              !event.altKey &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.shiftKey &&
              ['Backspace', 'Delete'].includes(event.key)
                ? {
                    key: event.key as 'Backspace' | 'Delete',
                    doc: _view.state.doc,
                    capture: this.editor!.isCapturingTransaction,
                  }
                : undefined;
            const keyIntent = this.mixedKey;
            queueMicrotask(() => {
              if (this.mixedKey === keyIntent) this.mixedKey = undefined;
            });
            if (
              this.selection.table?.kind === 'cell' &&
              _view.state.selection instanceof CellSelection &&
              !event.altKey &&
              !event.shiftKey &&
              !event.isComposing &&
              ['Delete', 'Backspace'].includes(event.key)
            ) {
              const logical = this.selection.table;
              const table =
                this.projection?.table ??
                this.projection?.mixed?.parts.find((part) => {
                  const window = part.projection.table?.window;
                  return (
                    window && logical.anchor.cell >= window.from && logical.anchor.cell < window.to
                  );
                })?.projection.table;
              if (table) {
                const intent = {
                  revision: this.service.revision,
                  table: table.window.from,
                  command: 'deleteSelection' as const,
                  selection: structuredClone(this.selection),
                };
                if (!this.service.stageLogicalTableCommand(intent, this.editor!, false))
                  return false;
                event.preventDefault();
                _view.dispatch(_view.state.tr.setMeta('proofLogicalTableCommand', intent));
                return true;
              }
            }
            const table = this.projection!.table;
            if (
              table &&
              !this.replayingInput &&
              this.selection.table &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              /^Arrow(Up|Down|Left|Right)$/.test(event.key)
            ) {
              const selection = _view.state.selection;
              const direction = /(?:Up|Left)$/.test(event.key) ? -1 : 1;
              const vertical = /(?:Up|Down)$/.test(event.key);
              let atCellEdge = event.shiftKey && selection instanceof CellSelection;
              // Use the same real line-edge test as native table key handling.
              if (
                selection instanceof TextSelection &&
                (event.shiftKey || !vertical || selection.empty)
              ) {
                const $head = selection.$head;
                for (let d = $head.depth - 1; d >= 0; d--) {
                  const parent = $head.node(d);
                  if (
                    (direction < 0 ? $head.index(d) : $head.indexAfter(d)) !==
                    (direction < 0 ? 0 : parent.childCount)
                  )
                    break;
                  if (
                    parent.type.spec.tableRole === 'cell' ||
                    parent.type.spec.tableRole === 'header_cell'
                  ) {
                    atCellEdge = _view.endOfTextblock(
                      vertical ? (direction < 0 ? 'up' : 'down') : direction < 0 ? 'left' : 'right',
                    );
                    break;
                  }
                }
              }
              const point = this.selection.table.head;
              const fragment = table.entries.find((entry) => entry.cell.from === point.cell)?.cell;
              const paragraph = table.paragraphs.find(
                (p) => p.cell.from === point.cell && p.block === point.block,
              );
              const clipped =
                fragment &&
                (fragment.first > fragment.body ||
                  fragment.last < fragment.end ||
                  (fragment.blocks && fragment.blocks.length < (fragment.blockCount ?? 0)));
              const artificialEdge =
                fragment &&
                paragraph &&
                (direction < 0
                  ? paragraph.offset > 0 || point.block > 0
                  : fragment.last < fragment.end || point.block + 1 < (fragment.blockCount ?? 1));
              if (
                selection instanceof TextSelection &&
                clipped &&
                (!atCellEdge || artificialEdge)
              ) {
                event.preventDefault();
                this.deferInput(
                  'tableText' + (event.shiftKey ? 'Extend' : 'Move') + event.key.slice(5),
                );
                return true;
              }
              if (atCellEdge) {
                const owner = this.selection.table.head.cell;
                const adjacent =
                  event.shiftKey || vertical
                    ? this.service.tableAdjacent(owner, vertical ? 'vert' : 'horiz', direction)
                    : undefined;
                const extending = event.shiftKey && !!adjacent;
                // Native unshifted horizontal arrows follow document order, even
                // across rows. Shift-Left falls through to that same previous
                // text position when no grid neighbor exists at the row origin.
                const next =
                  adjacent ??
                  (!vertical && (!event.shiftKey || direction < 0)
                    ? this.service.tableNeighbor(owner, direction, direction < 0)
                    : undefined);
                const entry = next && table.entries.find((e) => e.cell.from === next.point.cell);
                const anchorMissing = !table.entries.some(
                  (e) => e.cell.from === this.selection.table!.anchor.cell,
                );
                if (
                  next &&
                  (!entry ||
                    this.pendingFetch ||
                    this.service.pendingInputs ||
                    (extending && anchorMissing))
                ) {
                  event.preventDefault();
                  this.deferInput(
                    (extending ? 'tableExtend' : vertical ? 'tableArrow' : 'tableHorizontal') +
                      event.key.slice(5),
                  );
                  return true;
                }
              }
            }
            if (
              this.projection!.table &&
              !this.replayingInput &&
              event.key === 'Tab' &&
              this.selection.table
            ) {
              const direction = event.shiftKey ? -1 : 1;
              const next = this.service.tableNeighbor(this.selection.table.head.cell, direction);
              if (!next && direction > 0) this.tableTabAtEnd = true;
              const entry =
                next && this.projection!.table.entries.find((e) => e.cell.from === next.point.cell);
              if (next && (!entry || this.pendingFetch || this.service.pendingInputs)) {
                event.preventDefault();
                this.deferInput(direction < 0 ? 'tableTabBackward' : 'tableTabForward');
                return true;
              }
            }
            if (
              this.projection!.list &&
              !this.replayingInput &&
              (this.service.pendingInputs || this.pendingFetch) &&
              event.key === 'Tab'
            ) {
              event.preventDefault();
              this.deferInput(event.shiftKey ? 'outdent' : 'indent');
              return true;
            }
            if (
              (this.service.pendingInputs ||
                (this.selection.anchor === this.selection.head &&
                  this.selection.head === this.windowEnd &&
                  this.projection!.code.some((c) => c.fence.bodyTo > this.windowEnd))) &&
              !this.replayingInput &&
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              event.preventDefault();
              this.deferInput('insertParagraph');
              return true;
            }
            if (
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              (event.key === 'Delete' || event.key === 'Backspace')
            ) {
              const backward = event.key === 'Backspace';
              const atBoundary =
                this.selection.anchor === this.selection.head &&
                (backward
                  ? this.selection.head === this.projection!.start &&
                    this.projection!.start > this.service.start(this.active)
                  : this.selection.head === this.windowEnd &&
                    this.windowEnd < this.service.start(this.active + 1));
              if (this.service.pendingInputs || atBoundary) {
                event.preventDefault();
                this.deferInput(backward ? 'delete' : 'forwardDelete');
                return true;
              }
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
              event.preventDefault();
              if (this.service.pendingInputs) this.deferInput(event.shiftKey ? 'redo' : 'undo');
              else void this.history(event.shiftKey);
              return true;
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
              event.preventDefault();
              this.selectAll();
              return true;
            }
            if (
              (this.service.pendingInputs ||
                (this.projection!.list &&
                  this.selection.anchor === this.selection.head &&
                  ((event.key === 'ArrowLeft' &&
                    this.selection.head === this.projection!.start &&
                    this.projection!.start > 0) ||
                    (event.key === 'ArrowRight' &&
                      this.selection.head === this.windowEnd &&
                      this.windowEnd < this.service.length)))) &&
              !this.replayingInput &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
            ) {
              event.preventDefault();
              this.deferInput(
                (event.shiftKey ? 'extend' : 'move') +
                  (event.key === 'ArrowLeft' ? 'Backward' : 'Forward'),
              );
              return true;
            }
            const p = this.projection!;
            // Sparse mixed source concatenates only admitted fragments; its text
            // length is not the logical end of the revisioned source window.
            const admittedEnd = p.context?.to ?? p.start + p.source.length;
            const globalRange =
              !p.table &&
              (this.selection.anchor < p.start ||
                this.selection.head < p.start ||
                this.selection.anchor > admittedEnd ||
                this.selection.head > admittedEnd);
            if (
              globalRange &&
              event.shiftKey &&
              (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
            ) {
              event.preventDefault();
              this.selection.head = Math.max(
                0,
                Math.min(
                  this.service.length,
                  this.selection.head + (event.key === 'ArrowLeft' ? -1 : 1),
                ),
              );
              this.suppress = true;
              this.renderSelection();
              this.suppress = false;
              this.changed();
              return true;
            }
            return false;
          },
        },
      });
      const dispatch = this.editor.view.props.dispatchTransaction!;
      this.editor.view.setProps({
        dispatchTransaction: (tr) => {
          const current = this.editor!.state;
          const projection = this.projection;
          const fence = projection?.context?.fences?.find(
            (f) => f.to > projection.start + projection.source.length && f.from > projection.start,
          );
          if (
            !this.suppress &&
            !this.editor!.isCapturingTransaction &&
            tr.docChanged &&
            projection?.list &&
            fence
          ) {
            const key = this.mixedKey?.doc === current.doc ? this.mixedKey.key : undefined;
            const boundary = projection.pmAt(fence.bodyFrom);
            const crosses = current.selection.from < boundary && current.selection.to >= boundary;
            const atJoin =
              key === 'Backspace'
                ? current.selection.head === boundary
                : key === 'Delete' &&
                  current.selection.head < boundary &&
                  current.selection.$head.parentOffset ===
                    current.selection.$head.parent.content.size;
            if (crosses || atJoin) {
              const revision = projection.context!.revision;
              const span =
                revision === this.service.revision
                  ? this.service.mixedCodeSpan(fence.from, revision)
                  : { owner: fence.from, from: projection.start, to: fence.to };
              const intent: MixedCommand = {
                ...span,
                revision,
                selection: { ...this.fromPM(current.selection), revision },
                command: key ?? 'replace',
                ...(key ? { capture: this.mixedKey!.capture } : {}),
                ...(!key &&
                tr.steps.length === 1 &&
                tr.steps[0] instanceof ReplaceStep &&
                tr.steps[0].slice.openStart
                  ? {
                      replacement: {
                        from: projection.sourceAt(tr.steps[0].from, 1),
                        to: projection.sourceAt(tr.steps[0].to, -1),
                        slice: tr.steps[0].slice.toJSON() ?? {},
                        anchor: tr.selection.anchor - tr.steps[0].from,
                        head: tr.selection.head - tr.steps[0].from,
                      },
                    }
                  : {}),
                ...(!key
                  ? {
                      slice:
                        tr.doc
                          .slice(
                            tr.mapping.map(current.selection.from, -1),
                            tr.mapping.map(current.selection.to, 1),
                          )
                          .toJSON() ?? {},
                    }
                  : {}),
              };
              tr = current.tr
                .setTime(tr.time)
                .setMeta('composition', tr.getMeta('composition'))
                .setMeta('proofMixedCommand', intent);
            }
          }
          if (!this.editor!.isCapturingTransaction && tr.docChanged) this.mixedKey = undefined;
          if (!this.suppress && tr.docChanged && projection?.mixed && !current.selection.empty) {
            const tablePart = projection.mixed.parts.find(
              (part) =>
                part.projection.table &&
                current.selection.from < part.end &&
                current.selection.to > part.end,
            );
            if (tablePart) {
              const table = tablePart.projection.table!,
                revision = projection.context!.revision;
              const anchor = table.pointAt(current.selection.anchor - tablePart.pm),
                head = table.pointAt(current.selection.head - tablePart.pm);
              const point = anchor ?? head;
              if (point) {
                const neighbor =
                  revision === this.service.revision
                    ? this.service.tableFollowingParagraph(table.window.from, revision)
                    : { from: table.window.to, to: table.window.to };
                if (revision !== this.service.revision || neighbor.to > this.windowEnd) {
                  const dom = captureTableDOMReplacement(tr, current.selection);
                  tr = current.tr
                    .setTime(tr.time)
                    .setMeta('composition', tr.getMeta('composition'))
                    .setMeta('proofLogicalTableCommand', {
                      revision,
                      table: table.window.from,
                      command: 'replaceSelection',
                      neighbor,
                      selection: {
                        ...this.fromPM(current.selection),
                        revision,
                        table: { kind: 'text', anchor: anchor ?? point, head: head ?? point },
                      },
                      slice:
                        tr.doc
                          .slice(
                            tr.mapping.map(current.selection.from, -1),
                            tr.mapping.map(current.selection.to, 1),
                          )
                          .toJSON() ?? {},
                      ...dom,
                    });
                }
              }
            }
          }
          const logical = this.selection.table;
          const mounted =
            !this.suppress && logical?.kind === 'text'
              ? this.fromPM(this.editor!.state.selection).table
              : undefined;
          const step = tr.steps.length === 1 ? tr.steps[0] : undefined;
          const activeLogicalTable =
            logical &&
            (this.projection?.table ??
              this.projection?.mixed?.parts.find((part) => {
                const window = part.projection.table?.window;
                return (
                  window && logical.anchor.cell >= window.from && logical.anchor.cell < window.to
                );
              })?.projection.table);
          const outsideSelection =
            step instanceof ReplaceStep &&
            (step.from !== this.editor!.state.selection.from ||
              step.to !== this.editor!.state.selection.to);
          const aliasStepSelection =
            !this.suppress &&
            activeLogicalTable?.window.aliased &&
            outsideSelection &&
            step instanceof ReplaceStep &&
            !step.slice.openStart &&
            !step.slice.openEnd
              ? this.fromPM(TextSelection.create(this.editor!.state.doc, step.from, step.to))
              : undefined;
          const aliasStep =
            aliasStepSelection?.table?.kind === 'text' &&
            aliasStepSelection.table.anchor.cell === aliasStepSelection.table.head.cell;
          if (
            mounted &&
            logical &&
            (JSON.stringify(mounted) !== JSON.stringify(logical) ||
              activeLogicalTable?.window.aliased) &&
            step instanceof ReplaceStep &&
            (!outsideSelection || aliasStep)
          ) {
            const table = activeLogicalTable;
            if (table)
              tr = this.editor!.state.tr.setTime(tr.time)
                .setMeta('composition', tr.getMeta('composition'))
                .setMeta('proofLogicalTableCommand', {
                  revision: this.service.revision,
                  table: table.window.from,
                  command: 'replaceSelection',
                  selection: structuredClone(aliasStep ? aliasStepSelection : this.selection),
                  slice: step.slice.toJSON() ?? {},
                  ...(aliasStep
                    ? { preserve: { anchor: logical.anchor, head: logical.head } }
                    : {}),
                });
          }
          // ProseMirror's active mouse gesture remembers its pre-crop anchor.
          // Restore that source anchor before admitting its next selection transaction.
          if (
            !this.suppress &&
            !this.projection?.table &&
            this.pointerSelecting &&
            this.pointerRemapped &&
            this.pointerAnchor !== undefined &&
            tr.selectionSet &&
            !tr.docChanged
          ) {
            tr.setSelection(
              TextSelection.create(
                tr.doc,
                this.projection!.pmAt(this.pointerAnchor),
                tr.selection.head,
              ),
            );
          }
          if (
            (!!this.projection?.context?.fragments?.at(-1)?.context.table &&
              this.windowEnd < this.service.length) ||
            (this.projection?.list && this.windowEnd < this.service.length) ||
            this.projection?.code.some(
              (c) => c.fence.bodyTo >= this.windowEnd && c.fence.to > this.windowEnd,
            )
          )
            tr.setMeta('skipTrailingNode', true);
          if (this.replayTime !== undefined) tr.setTime(this.replayTime);
          this.rollbackState = this.editor!.state;
          try {
            dispatch.call(this.editor!.view, tr);
            if (this.pointerSelecting && this.pointerRemapped && !this.projection?.table) {
              // The view deliberately defers DOM selection writes during native mouse
              // drags. A crop replaced the highlighted text nodes, so reattach both
              // endpoints now rather than leaving Chromium on the detached anchor.
              const view = this.editor!.view;
              const anchor = view.domAtPos(view.state.selection.anchor);
              const head = view.domAtPos(view.state.selection.head);
              view.dom.ownerDocument
                .getSelection()
                ?.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
            }
          } finally {
            this.rollbackState = undefined;
          }
        },
      });
      this.created++;
      this.resizeTable(this.tableViewport, false);
      if (restore && this.projection.table && this.tableScroller) {
        const cells = this.projection.table.window.cells;
        this.tableScroller.scrollLeft =
          Math.min(...cells.map((c) => c.column)) * this.tableColumnWidth;
        this.tableScroller.scrollTop =
          this.projection.table.window.geometry?.top ?? cells[0].row * 41;
      }
      if (
        !restore &&
        (next.table
          ? next.table.pointPM(this.selection.table?.head) === undefined
          : this.selection.head < window.from || this.selection.head > window.to)
      ) {
        // Navigation changes the viewport, not the durable document selection.
        if (next.table?.window.trailing === false) {
          const selection = TextSelection.create(
            this.editor.state.doc,
            this.projection!.pmAt(window.from),
          );
          this.editor.view.updateState(
            EditorState.create({
              schema: this.editor.schema,
              doc: this.editor.state.doc,
              plugins: this.editor.state.plugins,
              selection,
            }),
          );
        } else this.editor.commands.setTextSelection(this.projection!.pmAt(window.from));
      } else this.renderSelection();
      this.suppress = false;
      if (this.projection.table?.window.trailing !== false) this.editor.view.focus();
      if (restoreViewport && this.projection.table && this.tableScroller) {
        const actual = this.projection.table.pointAt(this.editor.state.selection.head);
        if (JSON.stringify(actual) === JSON.stringify(this.selection.table?.head)) {
          if (restoreAnchor) this.preserveTableAnchor(restoreAnchor);
          else {
            // Reconstruct at the previous viewport before revealing the exact
            // logical endpoint. A clamped old crop is never a caret anchor.
            this.tableScroller.scrollLeft = restoreViewport.left;
            this.tableScroller.scrollTop = restoreViewport.top;
            this.revealTableCaret();
          }
          this.rememberTableAnchor();
        }
      }
      if (restore && position !== undefined && this.projection.table && this.tableScroller) {
        // A seek can request a different viewport without changing durable selection.
        // Reveal that admitted source position before deferred coverage observes it.
        const point = position === this.selection.head ? this.selection.table?.head : undefined;
        this.revealTableCaret(
          this.projection.table.pointPM(point) ?? this.projection.pmAt(position),
        );
      }
      if (!restore && this.projection.table && this.tableScroller && this.tableScrollRequest) {
        // Destroying the old DOM temporarily shrinks the scroll canvas. Restore
        // the requested viewport after mounting/layout, including fresh sessions
        // that have no focused native caret to recover the scroll position.
        this.tableScroller.scrollLeft = this.tableScrollRequest.left + this.tableOriginX;
        this.tableScroller.scrollTop = this.tableScrollRequest.top + this.tableOriginY;
        this.tableAnchoredScroll = {
          left: this.tableScroller.scrollLeft,
          top: this.tableScroller.scrollTop,
        };
      }
      this.error = '';
      this.changed();
      shown = true;
      return true;
    } finally {
      if (this.tableTargetCandidate?.navigation === ticket) this.tableTargetCandidate = undefined;
      if (!shown && this.tableViewTarget?.navigation === ticket) this.tableViewTarget = undefined;
      this.inFlightBytes -= sourcePayloadBytes(window.source);
    }
  }
  private revealTableCaret(position = this.editor!.state.selection.head) {
    const scroller = this.tableScroller!,
      view = this.editor!.view;
    if (!scroller.clientHeight) return;
    const caret = view.coordsAtPos(position, 1);
    const viewport = scroller.getBoundingClientRect();
    const threshold = view.someProp('scrollThreshold') || 0;
    const margin = view.someProp('scrollMargin') || 5;
    const side = (
      value: number | { top: number; bottom: number; left: number; right: number },
      key: 'top' | 'bottom' | 'left' | 'right',
    ) => (typeof value === 'number' ? value : value[key]);
    // Use native selection-reveal margins on the bounded table canvas. This
    // changes only viewport geometry, without inventing an edit transaction or
    // running appendTransaction while reconstructing a source-less terminal.
    if (caret.top < viewport.top + side(threshold, 'top'))
      scroller.scrollTop += caret.top - viewport.top - side(margin, 'top');
    else if (caret.bottom > viewport.top + scroller.clientHeight - side(threshold, 'bottom'))
      scroller.scrollTop +=
        caret.bottom - viewport.top - scroller.clientHeight + side(margin, 'bottom');
    if (caret.left < viewport.left + side(threshold, 'left'))
      scroller.scrollLeft += caret.left - viewport.left - side(margin, 'left');
    else if (caret.right > viewport.left + scroller.clientWidth - side(threshold, 'right'))
      scroller.scrollLeft +=
        caret.right - viewport.left - scroller.clientWidth + side(margin, 'right');
    this.tableAnchoredScroll = { left: scroller.scrollLeft, top: scroller.scrollTop };
  }
  private renderSelection() {
    const p = this.projection!,
      editor = this.editor!;
    const selection =
      p.restoreNodeSelection(editor.state.doc, this.selection) ??
      p.mixed?.restoreSelection(editor.state.doc, this.selection) ??
      p.table?.restoreSelection(editor.state.doc, this.selection) ??
      TextSelection.create(
        editor.state.doc,
        p.table?.pointPM(this.selection.table?.anchor) ??
          p.pmAt(this.selection.anchor, this.selection.affinity),
        p.table?.pointPM(this.selection.table?.head) ??
          p.pmAt(this.selection.head, this.selection.affinity),
      );
    if (this.suppress && p.table?.window.trailing === false) {
      // Mount a fresh selection without inventing a native edit transaction.
      // Real user transactions still run every native appendTransaction hook.
      if (!editor.state.selection.eq(selection))
        editor.view.updateState(
          EditorState.create({
            schema: editor.schema,
            doc: editor.state.doc,
            plugins: editor.state.plugins,
            selection,
          }),
        );
    } else editor.view.dispatch(editor.state.tr.setSelection(selection));
  }

  selectAll() {
    this.selection = {
      anchor: 0,
      head: this.service.length,
      affinity: 1,
      revision: this.service.revision,
    };
    this.suppress = true;
    this.renderSelection();
    this.suppress = false;
    this.changed();
  }
  private fromPM(selection: { anchor: number; head: number }): Selection {
    const p = this.projection!;
    let anchor = p.table?.pointAt(selection.anchor),
      head = p.table?.pointAt(selection.head);
    const cells = selection instanceof CellSelection;
    if (p.mixed) {
      anchor = p.mixed.pointAt(cells ? selection.$anchorCell.pos : selection.anchor, cells);
      head = p.mixed.pointAt(cells ? selection.$headCell.pos : selection.head, cells);
    }
    if (cells && p.table) {
      const a = p.table.entries.find((e) => e.pm === selection.$anchorCell.pos),
        h = p.table.entries.find((e) => e.pm === selection.$headCell.pos);
      anchor = a ? { cell: a.cell.from, block: 0, offset: 0 } : undefined;
      head = h ? { cell: h.cell.from, block: 0, offset: 0 } : undefined;
    }
    return {
      ...(selection instanceof NodeSelection
        ? { node: { from: p.sourceAt(selection.from), type: selection.node.type.name } }
        : {}),
      ...(anchor && head
        ? { table: { anchor, head, kind: cells ? ('cell' as const) : ('text' as const) } }
        : {}),
      anchor: p.sourceAt(selection.anchor),
      head: p.sourceAt(selection.head),
      affinity: selection.anchor <= selection.head ? 1 : -1,
      revision: this.service.revision,
    };
  }
  private commandGroups(tr: Transaction, ranges: CommandHistory) {
    const composition = tr.getMeta('composition');
    return (
      this.prevTime !== 0 &&
      ((composition !== undefined && composition === this.prevComposition) ||
        (tr.time - this.prevTime <= 500 &&
          ranges.before.some(([a, b]) =>
            this.prevRanges.some(([from, to]) => a <= to && b >= from),
          )))
    );
  }
  private rememberCommand(tr: Transaction, ranges: CommandHistory) {
    this.prevTime = tr.time;
    this.prevRanges = ranges.after;
    const composition = tr.getMeta('composition');
    if (composition !== undefined) this.prevComposition = composition;
  }
  private accept(transactions: Transaction[]) {
    if (this.suppress) return;
    const mixed = transactions.find((tr) => tr.getMeta('proofMixedCommand'));
    if (mixed) {
      let ranges: CommandHistory = { before: [], after: [] };
      const before = structuredClone(this.selection);
      try {
        const after = this.service.atomic(() => {
          this.service.beginChanges();
          const result = this.service.stageMixedCommand(
            mixed.getMeta('proofMixedCommand'),
            this.editor!,
            (history) => {
              ranges = history;
            },
          );
          this.service.recordEdit(before, result, this.commandGroups(mixed, ranges));
          return result;
        });
        this.selection = after;
        this.selectionGeneration++;
        this.rememberCommand(mixed, ranges);
        this.cache.clear();
        this.error = '';
        const navigation = this.navigation,
          generation = this.selectionGeneration;
        queueMicrotask(() => {
          if (
            this.navigation === navigation &&
            this.selectionGeneration === generation &&
            this.service.revision === after.revision &&
            this.editor
          )
            void this.seek(after.head);
        });
      } catch (error) {
        this.error = String(error);
        this.rejectedTransactions++;
        this.changed();
      }
      return;
    }
    const command = transactions.find((tr) => tr.getMeta('proofLogicalTableCommand'));
    if (command) {
      let ranges: CommandHistory = { before: [], after: [] };
      const before = structuredClone(this.selection);
      try {
        const after = this.service.atomic(() => {
          this.service.beginChanges();
          const after = this.service.stageLogicalTableCommand(
            command.getMeta('proofLogicalTableCommand'),
            this.editor!,
            true,
            true,
            (history) => {
              ranges = history;
            },
          );
          if (!after) throw new Error('Logical table command no longer applies');
          if (
            this.tableTabAtEnd &&
            command.getMeta('proofLogicalTableCommand').command === 'addRowAfter'
          ) {
            const next = this.service.tableNeighbor(before.table!.head.cell, 1);
            if (!next) throw new Error('Appended table row has no logical Tab destination');
            after.anchor = after.head = next.source;
            after.affinity = 1;
            after.table = { anchor: next.point, head: next.point, kind: 'text' };
          }
          this.service.recordEdit(before, after, this.commandGroups(command, ranges));
          return after;
        });
        this.tableTabAtEnd = false;
        this.tableTabDestination = undefined;
        this.selection = after;
        this.selectionGeneration++;
        this.rememberCommand(command, ranges);
        this.cache.clear();
        this.error = '';
        const navigation = this.navigation,
          generation = this.selectionGeneration;
        queueMicrotask(() => {
          if (
            this.navigation === navigation &&
            this.selectionGeneration === generation &&
            this.service.revision === after.revision &&
            this.editor
          )
            void this.seek(after.head);
        });
      } catch (error) {
        this.tableTabAtEnd = false;
        this.tableTabDestination = undefined;
        this.error = String(error);
        this.rejectedTransactions++;
        this.changed();
      }
      return;
    }
    const logicalSplit = transactions.find((tr) => tr.getMeta('proofLogicalTableSplit'));
    if (logicalSplit) {
      const before = structuredClone(this.selection);
      try {
        const after = this.service.atomic(() => {
          this.service.beginChanges();
          const result = this.service.stageLogicalTableSplit(
            logicalSplit.getMeta('proofLogicalTableSplit'),
          );
          const after: Selection = { ...before, revision: result.revision };
          if (after.table?.kind === 'cell') {
            after.table = { ...after.table, head: { cell: result.last, block: 0, offset: 0 } };
            after.head = result.lastSource;
          }
          this.service.recordEdit(before, after, false);
          return after;
        });
        this.selection = after;
        this.selectionGeneration++;
        this.prevTime = 0;
        this.cache.clear();
        this.error = '';
        // Finish native command dispatch before replacing its mounted view.
        queueMicrotask(() => {
          void this.seek(after.anchor);
        });
      } catch (error) {
        this.error = String(error);
        this.rejectedTransactions++;
        this.changed();
      }
      return;
    }
    // Native tableEditing normalizes selecting the table node to its entire
    // cell rectangle. Its source identity includes cells outside this crop.
    const selectedTableNode = transactions.find(
      (tr) =>
        !tr.docChanged &&
        tr.selection instanceof NodeSelection &&
        tr.selection.node.type.name === 'table',
    );
    const wholeTable =
      selectedTableNode &&
      this.projection?.mixed?.parts.find((part) => part.pm === selectedTableNode.selection.from)
        ?.projection.table;
    const wholeSelection =
      wholeTable &&
      (() => {
        const table = wholeTable.window;
        const first = this.service.tableAddress(table.from, 0, 0),
          last = this.service.tableAddress(table.from, table.rows - 1, table.columns - 1);
        return {
          anchor: first.source,
          head: last.source,
          affinity: 1 as const,
          revision: this.service.revision,
          table: { kind: 'cell' as const, anchor: first.point, head: last.point },
        };
      })();
    let mixedAppended = 0;
    const mixedRootMaps = this.projection?.mixed ? transactions[0].mapping.maps.length : undefined;
    if (this.projection?.mixed && transactions.length > 1 && transactions[0].docChanged) {
      // Reuse the actual immutable native documents and steps. Table fixups may
      // temporarily remove a cell; only the final appended result is admissible.
      const root = transactions[0],
        last = transactions.at(-1)!;
      const mapping = new Mapping();
      for (const tr of transactions) mapping.appendMapping(tr.mapping);
      const fields: Record<string, unknown> = {
        before: root.before,
        doc: last.doc,
        mapping,
        docs: transactions.flatMap((tr) => tr.docs),
        steps: transactions.flatMap((tr) => tr.steps),
        selection: last.selection,
        selectionSet: transactions.some((tr) => tr.selectionSet),
        docChanged: true,
      };
      mixedAppended = transactions.slice(1).filter((tr) => tr.docChanged).length;
      transactions = [
        new Proxy(root, {
          get(target, key) {
            if (typeof key === 'string' && key in fields) return fields[key];
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }),
      ];
    }
    const old = {
      projection: this.projection,
      windowEnd: this.windowEnd,
      selection: this.selection,
      prevTime: this.prevTime,
      prevComposition: this.prevComposition,
      prevRanges: this.prevRanges,
      acceptedRoots: this.acceptedRoots,
      acceptedAppended: this.acceptedAppended,
    };
    const parentRollback = this.tableRollback;
    if (old.projection?.tableSource)
      this.tableRollback = { projection: old.projection, parent: parentRollback };
    try {
      this.service.atomic(() => {
        this.acceptedAppended += mixedAppended;
        for (let index = 0; index < transactions.length; index++) {
          const tr = transactions[index];
          if (!tr.docChanged) {
            if (tr.selectionSet) {
              this.selection =
                wholeSelection ?? this.tableTabDestination ?? this.fromPM(tr.selection);
              this.selectionGeneration++;
              if (this.service.pendingInputs && !this.replayingInput)
                this.service.enqueueInput({
                  command: 'selection',
                  time: tr.time,
                  selection: { ...this.selection },
                });
            }
            continue;
          }
          let nodes = 0;
          tr.doc.descendants(() => {
            nodes++;
          });
          if (this.projection?.mixed) MixedProjection.nodeBudget(tr.doc.toJSON());
          else if (
            nodes + Number(!!this.projection?.table) >
            (this.projection?.table ? TABLE_NODE_LIMIT : LIMITS.nodes)
          )
            throw new Error('Proof projection exceeds node budget');
          if (index) this.acceptedAppended++;
          else this.acceptedRoots++;
          const before = { ...this.selection };
          let tableAfter: Selection | undefined;
          let adjacent = false;
          tr.mapping.maps[0]?.forEach((from, to) => {
            const start = this.projection!.sourceAt(from),
              end = this.projection!.sourceAt(to);
            if (this.prevRanges.some(([from, to]) => start <= to && end >= from)) adjacent = true;
          });
          const history =
            tr.getMeta('addToHistory') !== false &&
            transactions[0].getMeta('addToHistory') !== false;
          this.service.beginChanges();
          let oldStart = this.projection!.start;
          const mixedBatch = this.projection!.mixed?.translateTransaction(tr);
          const tableBatch = this.projection!.table ?? mixedBatch?.table;
          const listProjection = this.projection!.list ?? mixedBatch?.list;
          const terminalAppend =
            tableBatch &&
            !tr.selectionSet &&
            tr.before.childCount === 1 &&
            tr.doc.childCount === 2 &&
            tr.doc.lastChild!.type.name === 'paragraph' &&
            !tr.doc.lastChild!.content.size &&
            tr.before.firstChild!.eq(tr.doc.firstChild!);
          let terminalState: ReturnType<SourceJournal['stageTableTrailing']> | undefined;
          const listBatch = !!listProjection || !!tableBatch || !!mixedBatch;
          for (let n = 0; n < (listBatch ? 1 : tr.steps.length); n++) {
            let fences: NonNullable<InlineContext['fences']> = [];
            // Native joins may have intermediate structures with no Markdown representation.
            // Admit the final list document atomically using every step's token mapping.
            const splices = mixedBatch
              ? mixedBatch.splices
              : tableBatch
                ? tableBatch.translateTransaction(tr, (pm, affinity) =>
                    this.projection!.sourceAt(pm, affinity),
                  )
                : listBatch
                  ? this.projection!.list!.translateTransaction(tr)
                  : this.projection!.translate(tr.steps[n], tr.docs[n], (next) => {
                      fences = next;
                    });
            if (listProjection) fences = listProjection.fences;
            if (mixedBatch) fences = mixedBatch.fences;
            if (tableBatch?.codeChanges.length)
              splices.push(...this.service.tableCodePatches(tableBatch.codeChanges));
            if (mixedBatch && tableBatch?.structural)
              throw new Error('Mixed structural table admission required');
            if (tableBatch?.structural) {
              const table = this.service.stageTableStructure(
                tableBatch.window,
                tableBatch.structural,
                history,
              );
              this.projection = this.project(
                new TableSourceView(table),
                table.cells[0].first,
                table,
              );
              this.windowEnd = table.cells.at(-1)!.last;
              if (this.tableTabAtEnd && tableBatch.structural.kind === 'row') {
                const target = this.service.tableAddress(
                  table.from,
                  tableBatch.structural.index,
                  0,
                );
                tableAfter = {
                  anchor: target.source,
                  head: target.source,
                  affinity: 1,
                  revision: this.service.revision,
                  table: { anchor: target.point, head: target.point, kind: 'text' },
                };
                this.tableTabDestination = tableAfter;
              }
            } else {
              const listSeams = listProjection?.seams;
              this.maxSeamAdmissionBytes = Math.max(
                this.maxSeamAdmissionBytes,
                bytes(JSON.stringify(listSeams ?? [])),
              );
              if (tableBatch && this.projection!.context!.revision !== this.service.revision)
                throw new Error('Stale table transaction');
              if (tableBatch)
                for (const changed of tableBatch.changedCells)
                  if (changed.inline) this.service.stageTableInline(changed.inline, history);
                  else if (changed.paragraphs)
                    this.service.stageTableParagraphs(changed.paragraphs, history);
                  else this.service.stageTableCell(changed.cell, changed.node, history);
              this.service.stageProjection(
                splices,
                fences,
                tableBatch ? this.service.revision : this.projection!.context!.revision,
                history,
                listProjection?.indentation,
                (splice) => {
                  oldStart = mapPoint(oldStart, splice, -1);
                  this.windowEnd = mapPoint(this.windowEnd, splice);
                  if (!history)
                    this.prevRanges = this.prevRanges.map(([from, to]) => [
                      mapPoint(from, splice),
                      mapPoint(to, splice),
                    ]);
                },
              );
              if (listProjection)
                this.service.setLiteralNewlines(
                  oldStart,
                  this.windowEnd,
                  listProjection.literalNewlines,
                );
              if (listProjection)
                this.service.setListCodes(
                  oldStart,
                  this.windowEnd,
                  listProjection.codes,
                  this.service.revision,
                  history,
                );
              for (const seam of this.projection!.addedParagraphSeams)
                this.service.setParagraphSeam(seam, this.service.revision, history);
              if (listSeams)
                this.service.setSeams(
                  oldStart,
                  this.windowEnd,
                  listSeams,
                  this.service.revision,
                  history,
                );
              if (tableBatch && tr.doc.firstChild?.type.name === 'table') {
                const trailing =
                  tr.doc.childCount === 2 &&
                  tr.doc.lastChild!.type.name === 'paragraph' &&
                  !tr.doc.lastChild!.content.size;
                // Native trailingNode recreates this placeholder even during undo.
                // Retain its session lifecycle without an inverse that removes it.
                if (terminalAppend || trailing !== (tableBatch.window.trailing !== false))
                  terminalState = this.service.stageTableTrailing(
                    tableBatch.window.from,
                    trailing,
                    this.service.revision,
                    false,
                  );
              }
              if (this.projection!.table) {
                let table;
                if (terminalAppend && terminalState) {
                  // The native table itself is unchanged. A bounded metadata reply
                  // updates its revision without resending the resident fragments.
                  const previous = tableBatch!.window;
                  if (
                    terminalState.table !== previous.from ||
                    terminalState.revision !== this.service.revision
                  )
                    throw new Error('Stale table terminal acknowledgement');
                  table = {
                    ...previous,
                    revision: terminalState.revision,
                    trailing: terminalState.trailing,
                    ...(previous.geometry
                      ? { geometry: { ...previous.geometry, revision: terminalState.revision } }
                      : {}),
                  };
                  const responseBytes = bytes(JSON.stringify(terminalState));
                  this.maxTableTransferPageBytes = Math.max(
                    this.maxTableTransferPageBytes,
                    responseBytes,
                  );
                  this.maxTableTransferBytes = Math.max(this.maxTableTransferBytes, responseBytes);
                  this.maxTableResidentAndAssemblyBytes = Math.max(
                    this.maxTableResidentAndAssemblyBytes,
                    responseBytes * 3 +
                      bytes(JSON.stringify(previous)) +
                      bytes(JSON.stringify(table)) +
                      this.projection!.sourcePayloadBytes,
                  );
                } else {
                  const retained = cloneTableWindow(tableBatch!.window);
                  for (const splice of splices)
                    for (const cell of retained.cells) {
                      cell.first = mapPoint(cell.first, splice, -1);
                      cell.last = mapPoint(cell.last, splice, 1);
                    }
                  const target = mapPoint(
                    before.head,
                    splices[0] ?? { from: 0, to: 0, insert: '' },
                  );
                  table = this.receiveTable(
                    this.service.tableWindowPages(target, retained),
                    'packed-cells',
                  )!;
                }
                this.projection = this.project(
                  new TableSourceView(table),
                  table.cells[0].first,
                  table,
                );
                this.windowEnd = table.cells.at(-1)!.last;
              } else if (this.projection!.context?.fragments)
                this.projection = this.refreshSparse(splices);
              else
                this.projection = this.project(this.readRange(oldStart, this.windowEnd), oldStart);
            }
            if (
              (this.projection.list || this.projection.table || this.projection.mixed) &&
              !this.editor!.schema.nodeFromJSON(this.projection.content).eq(
                listBatch ? tr.doc : tr.steps[n].apply(tr.docs[n]).doc!,
              )
            ) {
              throw new Error('Translated source differs from accepted document');
            }
          }
          // A native source-less append does not move the logical selection,
          // including endpoints that are outside the admitted rectangle.
          const after =
            tableAfter ??
            (terminalAppend
              ? { ...before, revision: this.service.revision }
              : this.fromPM(tr.selection));
          const composition = tr.getMeta('composition');
          const group =
            this.prevTime !== 0 &&
            (index > 0 ||
              (composition !== undefined && composition === this.prevComposition) ||
              (tr.time - this.prevTime <= 500 && !!adjacent));
          if (history) this.service.recordEdit(before, after, group);
          if (history) {
            this.prevRanges = [];
            for (
              let m = (mixedRootMaps ?? tr.mapping.maps.length) - 1;
              m >= 0 && !this.prevRanges.length;
              m--
            ) {
              tr.mapping.maps[m].forEach((_from, _to, from, to) => {
                // Native history tracks the root edit range through appended fixups.
                // A table repair/trailing paragraph is not the preceding typing range.
                const tail = tr.mapping.slice(m + 1);
                const start = tail.map(from, 1),
                  end = tail.map(to, -1);
                if (start <= end)
                  this.prevRanges.push([
                    this.projection!.sourceAt(start),
                    this.projection!.sourceAt(end),
                  ]);
              });
            }
            this.prevTime = tr.time;
            if (composition !== undefined) this.prevComposition = composition;
          }
          this.selection = after;
          this.selectionGeneration++;
          this.cache.clear();
        }
      });
      if (this.tableTabAtEnd && this.tableTabDestination) {
        this.tableTabAtEnd = false;
        const destination = this.tableTabDestination;
        queueMicrotask(() => {
          // Native focus/selection callbacks may dispatch before this queued mount.
          // Retain the accepted destination, not a mutable dispatch scratch field.
          this.selection = destination;
          this.tableTabDestination = undefined;
          void this.seek(destination.head);
        });
      }
      if (wholeTable && wholeSelection)
        wholeTable.window.selected = {
          anchor: wholeSelection.table.anchor.cell,
          head: wholeSelection.table.head.cell,
          top: 0,
          bottom: wholeTable.window.rows,
          left: 0,
          right: wholeTable.window.columns,
          backwardRows: false,
          backwardColumns: false,
        };
      this.resizeTable(this.tableViewport);
      this.error = '';
      // Only source changes invalidate anchors. Refreshing during a selectionchange can
      // race the browser's next native selection update.
      if (transactions.some((tr) => tr.docChanged)) void this.loadAnnotations();
      this.changed();
      this.continueNearEdge(transactions.some((tr) => tr.docChanged));
    } catch (error) {
      this.tableTabAtEnd = false;
      this.tableTabDestination = undefined;
      Object.assign(this, old);
      if (this.rollbackState) this.editor!.view.updateState(this.rollbackState);
      this.error = String(error);
      this.rejectedTransactions++;
      this.lastRejection = this.error.slice(0, 512);
      this.changed();
    } finally {
      this.tableRollback = parentRollback;
    }
  }
  async history(redo = false) {
    const index = redo ? this.service.cursor : this.service.cursor - 1;
    if (index < 0 || index >= this.service.depth) return false;
    const event = this.service.event(index);
    const anchorPoint = this.selection.table?.head;
    this.service.atomic(() => {
      this.service.bookmark(index, redo ? 'before' : 'after', this.selection);
      for (const change of this.service.changes(index, !redo)) this.service.replay(change, redo);
      this.service.restoreEventAnchors(index, redo);
      this.service.cursor += redo ? 1 : -1;
    });
    this.selection = { ...(redo ? event.after : event.before), revision: this.service.revision };
    this.prevTime = 0;
    this.cache.clear();
    await this.seek(this.selection.head, true, anchorPoint);
    return true;
  }
  save() {
    this.service.save();
    this.changed();
  }
  copy() {
    return this.service.slice(
      Math.min(this.selection.anchor, this.selection.head),
      Math.max(this.selection.anchor, this.selection.head),
    );
  }
  /** Source-level adapters exercise ranges larger than the mounted document without hydration. */
  async replaceSelection(insert: string) {
    const before = { ...this.selection };
    const from = Math.min(before.anchor, before.head),
      to = Math.max(before.anchor, before.head);
    const after = this.service.atomic(() => {
      this.service.beginChanges();
      this.service.stage({ from, to, insert });
      const after: Selection = {
        anchor: from + insert.length,
        head: from + insert.length,
        affinity: 1,
        revision: this.service.revision,
      };
      this.service.recordEdit(before, after, false);
      return after;
    });
    this.selection = after;
    this.prevTime = 0;
    this.cache.clear();
    await this.seek(from);
  }
  remote(splice: Splice) {
    const anchorPoint = this.selection.table?.head;
    const table = !!this.projection?.table || !!this.projection?.context?.fragments;
    const oldStart = this.projection!.start;
    this.service.atomic(() => {
      this.service.validateTableRemote(splice);
      this.service.apply(splice);
      this.service.rebase(splice);
    });
    this.selection = mapSelection(this.selection, splice, this.service.revision);
    this.windowEnd = mapPoint(this.windowEnd, splice);
    this.prevRanges = this.prevRanges.map(([from, to]) => [
      mapPoint(from, splice),
      mapPoint(to, splice),
    ]);
    this.cache.clear();
    if (table) {
      void this.seek(this.selection.head, true, anchorPoint);
      return;
    }
    if (splice.to <= oldStart) {
      // Remote delimiter changes can turn either mapped edge into an empty mark span.
      const start = this.service.inlineBoundary(mapPoint(oldStart, splice), 1);
      this.windowEnd = this.service.inlineBoundary(this.windowEnd, -1);
      this.projection = this.project(this.readRange(start, this.windowEnd), start);
      // A remote delimiter outside the crop can change its marks without changing its text.
      const editor = this.editor!;
      const doc = editor.schema.nodeFromJSON(this.projection.content);
      if (!doc.eq(editor.state.doc)) {
        this.suppress = true;
        try {
          const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content);
          tr.setSelection(
            TextSelection.create(
              tr.doc,
              this.projection.pmAt(this.selection.anchor, this.selection.affinity),
              this.projection.pmAt(this.selection.head, this.selection.affinity),
            ),
          );
          editor.view.dispatch(tr.setMeta('addToHistory', false));
        } finally {
          this.suppress = false;
        }
      }
      this.editor?.view.setProps({});
      void this.loadAnnotations();
      this.changed();
    } else void this.seek(this.selection.head);
  }
  snapshot() {
    const tableOwners = this.measureTableOwners();
    // Reuse only synchronous numeric results within this publication. Annotation,
    // plugin and backing-service state remain fresh on every publication phase.
    const activeBytes = this.projection?.sourcePayloadBytes ?? 0;
    const inlineContextBytes = bytes(JSON.stringify(this.projection?.context ?? {}));
    const codeMetadataBytes = bytes(JSON.stringify(this.projection?.code ?? []));
    const projectionJsonBytes = bytes(JSON.stringify(this.projection?.content ?? {}));
    const pmBytes = bytes(JSON.stringify(this.editor?.getJSON() ?? {}));
    const editorContentOptionBytes = bytes(JSON.stringify(this.editor?.options.content ?? {}));
    const cacheBytes = [...this.cache.values()].reduce((n, page) => n + bytes(page), 0);
    let nodes = 0;
    this.editor?.state.doc.descendants(() => {
      nodes++;
    });
    const pluginStates =
      this.editor?.state.plugins
        .map((plugin) => plugin.getState(this.editor!.state))
        .filter((value) => value !== undefined) ?? [];
    const seen = new WeakSet<object>();
    const pluginPayload = JSON.stringify(pluginStates, (_key, value) => {
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[shared reference]';
        seen.add(value);
      }
      return value;
    });
    const tables = this.projection?.table
      ? [{ pm: 0, table: this.projection.table }]
      : (this.projection?.mixed?.parts.flatMap((part) =>
          part.projection.table ? [{ pm: part.pm, table: part.projection.table }] : [],
        ) ?? []);
    const tableBound =
      tables.length && this.editor
        ? tableResourceBound(
            this.projection?.table
              ? this.editor.getJSON()
              : {
                  type: 'doc',
                  content: this.editor.getJSON().content?.filter((node) => node.type === 'table'),
                },
          )
        : undefined;
    const tableDOM =
      tableBound && this.editor
        ? this.projection?.table
          ? measureTableDOM(this.editor.view.dom, tableBound)
          : tables.reduce(
              (total, part) => {
                const dom = this.editor!.view.nodeDOM(part.pm);
                if (!(dom instanceof HTMLElement))
                  throw new Error('Missing mounted mixed table DOM');
                const measured = measureTableDOM(dom, tableResourceBound(part.table.content));
                return {
                  elements: total.elements + measured.elements,
                  textNodes: total.textNodes + measured.textNodes,
                };
              },
              { elements: 0, textNodes: 0 },
            )
        : undefined;
    return {
      tableCoverage: { ...this.tableCoverage },
      tableCoverageIntentBytes: this.tableIntentBytes,
      maxTableIntentAdmissionBytes: this.maxTableIntentAdmissionBytes,
      maxSourceContextBytes: this.maxSourceContextBytes,
      clipboardRelay: { ...this.clipboardRelay },
      maxBackingClipboardMutationBytes: this.service.maxBackingClipboardMutationBytes,
      externalClipboardBacking: {
        ...this.service.clipboardBacking.stats,
        retainedBytes: this.service.clipboardBacking.retainedBytes,
      },
      externalClipboardSink: {
        maxStagingBytes: this.service.clipboardSink.maxStagingBytes,
        stagingBytes: this.service.clipboardSink.stagingBytes,
        publications: this.service.clipboardSink.publications,
      },
      externalClipboardInput: {
        cellSerialization: { ...this.service.clipboardCellSerialization },
        ...this.service.clipboardInput.stats,
        retainedBytes: this.service.clipboardInput.retainedBytes,
        maxStagingBytes: this.service.clipboardInputSink.maxStagingBytes,
        stagingBytes: this.service.clipboardInputSink.stagingBytes,
        maxDOMElements: this.service.maxClipboardInputDOM,
        maxRepeatedPMNodes: this.service.maxClipboardInputNodes,
        maxRepeatedSerializedBytes: this.service.maxClipboardRepeatedBytes,
        maxBackingRangeFitNodes: this.service.maxClipboardRangeFitNodes,
        maxBackingRangeFitSerializedBytes: this.service.maxClipboardRangeFitBytes,
        maxBackingRangePlanBytes: this.service.maxClipboardRangePlanBytes,
        maxBackingTextFitNodes: this.service.maxClipboardTextFitNodes,
        maxBackingTextFitSerializedBytes: this.service.maxClipboardTextFitBytes,
        maxBackingTextFitDOMElements: this.service.maxClipboardTextFitDOM,
        maxBackingPastePlanBytes: this.service.maxClipboardPastePlanBytes,
        maxBackingPastePlanCells: this.service.maxClipboardPastePlanCells,
        maxBackingPasteMetadataBytes: this.service.maxClipboardPasteMetadataBytes,
        maxBackingPasteSourceBytes: this.service.maxClipboardPasteSourceBytes,
      },
      tableEditWork: { ...tableEditWork },
      tableRunParseCalls: tableRunWork.calls,
      tableRunParseBytes: tableRunWork.bytes,
      maxTableRunParseBytes: tableRunWork.maxBytes,
      tableSourceOwnerCount: this.projection?.tableSource ? 1 : 0,
      tableRollbackOwnerActive: !!this.tableRollback,
      tableLiveOwnerCount: tableOwners.ownerCount,
      tableLivePayloadBytes: tableOwners.payloadBytes,
      maxTableLivePayloadBytes: this.maxTableLivePayloadBytes,
      maxTableRollbackFrames: this.maxTableRollbackFrames,
      maxTableSourceOwnerOverlap: this.maxTableSourceOwnerOverlap,
      maxTableDescriptorOverlapBytes: this.maxTableDescriptorOverlapBytes,
      maxTableCacheAndDecodeBytes: this.maxTableCacheAndDecodeBytes,
      tableReceiveAccounting: { ...this.tableReceiveAccounting },
      tableAccountingDescriptorBytes: bytes(JSON.stringify(this.tableReceiveAccounting)),
      tableCloneWork: { ...tableCloneWork },
      debugPublicationBytes: this.debugPublicationBytes,
      maxDebugPublicationOverlapBytes: this.maxDebugPublicationOverlapBytes,
      maxTableAliasExpansionBytes: tableAliasExpansionWork.maxBytes,
      maxTableAliasResidentBytes: tableAliasExpansionWork.maxResidentBytes,
      tableResourceBound: tableBound,
      tableDomElements: tableDOM?.elements ?? 0,
      tableDomTextNodes: tableDOM?.textNodes ?? 0,
      maxTableTransferPageBytes: this.maxTableTransferPageBytes,
      maxTableTransferBytes: this.maxTableTransferBytes,
      maxTableAssemblyBytes: this.maxTableAssemblyBytes,
      maxTableRestoreAnchorBytes: this.maxTableRestoreAnchorBytes,
      maxTableResidentAndAssemblyBytes: this.maxTableResidentAndAssemblyBytes,
      tableColumnWidth: this.tableColumnWidth,
      tableCells: tables.reduce((n, part) => n + part.table.entries.length, 0),
      tableAnchorStateBytes: bytes(
        JSON.stringify({
          anchor: this.tableAnchor,
          originX: this.tableOriginX,
          originY: this.tableOriginY,
        }),
      ),
      tableGeometryBytes: bytes(JSON.stringify(this.projection?.table?.window.geometry ?? {})),
      maxTableGeometryReadBytes: this.service.tableHeights.maxReadBytes,
      maxTableGeometryWriteBytes: this.service.tableHeights.maxWriteBytes,
      maxTableCellMeasurementBytes: this.service.tableHeights.maxCellWriteBytes,
      backingTableGeometryBytes: this.service.tableHeights.backingBytes,
      backingTableGeometryScannedRows: this.service.tableHeights.scannedRows,
      tableContextBytes: bytes(JSON.stringify(tables.map((part) => part.table.window))),
      maxTableWindowBytes: this.service.maxTableWindowBytes,
      backingTableScannedBytes: this.service.backingTableScannedBytes,
      maxSeamMetadataBytes: this.maxSeamMetadataBytes,
      maxSeamAdmissionBytes: this.maxSeamAdmissionBytes,
      maxResidentAndInFlightSeamBytes: this.maxResidentAndInFlightSeamBytes,
      seamMetadataBytes: bytes(JSON.stringify(this.projection?.context?.seams ?? [])),
      nestedCodeMetadataBytes: bytes(JSON.stringify(this.projection?.context?.listCodes ?? [])),
      listMetadataBytes: bytes(JSON.stringify(this.projection?.context?.lists ?? [])),
      syntheticListParents: this.projection?.list?.synthetic.length ?? 0,
      listProjectionPayloadBytes:
        this.projection?.list?.measurePayload() ??
        bytes(JSON.stringify({ positions: [], ends: [], boundaries: [], parts: [] })),
      listMeasurementScalars: this.projection?.list?.measurementScalars ?? 0,
      listMeasurementPayloadBytes: this.projection?.list?.measurementPayloadBytes ?? 0,
      maxHighlightBytes: this.maxHighlightBytes,
      highlightCalls: this.highlightCalls,
      mixedProjectionPayloadBytes: bytes(
        JSON.stringify(
          this.projection?.mixed?.parts.map(({ pm, end, projection: p }) => ({
            pm,
            end,
            source: p.source,
            context: p.context,
            positions: [...p.positions],
            ends: [...p.ends],
            boundaries: [...p.boundaries],
            tokens: p.tokens,
            content: p.content,
            list: p.list,
            code: p.code,
            table: p.table && {
              ...p.table,
              positions: [...p.table.positions],
              ends: [...p.table.ends],
              boundaries: [...p.table.boundaries],
            },
          })) ?? [],
        ),
      ),
      codeMetadataBytes,
      residentInputBytes: this.residentInputBytes,
      maxResidentInputBytes: this.maxResidentInputBytes,
      continuation: this.continuation,
      windowFrom: this.projection?.start,
      windowTo: this.windowEnd,
      inlineContextBytes,
      maxProjectionInputBytes: this.maxProjectionInputBytes,
      continuationMetadataBytes: bytes(
        JSON.stringify({
          from: this.projection?.start,
          to: this.windowEnd,
          region: this.active,
          revision: this.service.revision,
        }),
      ),
      retainedEditorStates: Number(!!this.rollbackState),
      pointerSelecting: this.pointerSelecting,
      pluginStateFields: pluginStates.length,
      pluginStatePayloadBytes: bytes(pluginPayload),
      tokenProvenancePayloadBytes: bytes(JSON.stringify(this.projection?.tokens ?? [])),
      pendingWindowRequests: Number(!!this.pendingFetch),
      pendingNavigationRequests: Number(!!this.pendingNavigation),
      markProvenancePayloadBytes: bytes(JSON.stringify(this.projection?.marks ?? [])),
      active: this.active,
      error: this.error,
      selection: this.selection,
      source: this.projection?.tableSource?.descriptor ?? this.projection?.source,
      logicalSourceBytes: this.projection?.sourceLogicalBytes ?? 0,
      tableSourceDescriptorBytes: this.projection?.tableSource?.payloadBytes ?? 0,
      reads: this.service.reads,
      maxSourceRead: this.service.maxRead,
      // Count duplicated source/text representations explicitly; these are serialized payload
      // counts, not a heap measurement. Mock backing source and oracle live elsewhere.
      sourceReplicaPayloadBytes:
        activeBytes +
        (this.projection?.list?.entries.reduce((n, e) => n + bytes(e.part?.source ?? ''), 0) ?? 0) +
        (this.projection?.list?.prose.reduce((n, e) => n + bytes(e.part.source), 0) ?? 0) +
        inlineContextBytes +
        codeMetadataBytes +
        cacheBytes +
        this.inFlightBytes +
        (this.projection?.tokens.reduce((n, t) => n + bytes(t.raw) + bytes(t.text), 0) ?? 0) +
        projectionJsonBytes +
        pmBytes +
        editorContentOptionBytes,
      calls: this.service.logs,
      created: this.created,
      maxDOMBoundaryIntentBytes: this.maxDOMBoundaryIntentBytes,
      destroyed: this.destroyed,
      mounted: this.created - this.destroyed,
      pmNodes: nodes + Number(!!this.projection?.table),
      pmBytes,
      pluginCount: this.editor?.state.plugins.length ?? 0,
      nativeHistoryPlugins:
        this.editor?.state.plugins.filter((p) =>
          String((p as unknown as { key: string }).key).startsWith('history$'),
        ).length ?? 0,
      projectionJsonBytes,
      editorContentOptionBytes,
      provenanceEntries:
        (this.projection?.positions.size ?? 0) +
        (this.projection?.ends.size ?? 0) +
        (this.projection?.boundaries.size ?? 0),
      provenancePayloadBytes: bytes(
        JSON.stringify([
          ...(this.projection?.positions ?? []),
          ...(this.projection?.ends ?? []),
          ...(this.projection?.boundaries ?? []),
        ]),
      ),
      annotationPayloadBytes: this.service.annotationPayloadBytes,
      annotationCachePages: [...this.cache.keys()].filter((key) => key.startsWith('annotations:'))
        .length,
      annotationCacheBytes: [...this.cache]
        .filter(([key]) => key.startsWith('annotations:'))
        .reduce((n, [, value]) => n + bytes(value), 0),
      maxAnnotationCacheBytes: this.maxAnnotationCacheBytes,
      annotationInFlightBytes: this.annotationInFlightBytes,
      maxAnnotationInFlightBytes: this.maxAnnotationInFlightBytes,
      mountedAnnotations: this.annotationPage?.items.length ?? 0,
      moreAnnotations: !!this.annotationPage?.next,
      rendererJournalPages: 0,
      activeBytes,
      cachePages: this.cache.size,
      cacheBytes,
      inFlightBytes: this.inFlightBytes,
      maxInFlightBytes: this.maxInFlightBytes,
      parsedBytes: this.parsedBytes,
      maxParsedBytes: this.maxParsedBytes,
      acceptedRoots: this.acceptedRoots,
      acceptedAppended: this.acceptedAppended,
      ...this.service.stats,
      rejectedTransactions: this.rejectedTransactions,
      lastRejection: this.lastRejection,
    };
  }
  destroy() {
    this.annotationTicket++;
    this.annotationPage = undefined;
    this.tableResize?.disconnect();
    this.tableMeasurements?.disconnect();
    this.tableFontObserver?.disconnect();
    this.tableScroller?.removeEventListener('scroll', this.tableScroll);
    this.navigation++;
    this.host.removeEventListener('pointerdown', this.pointerDown);
    document.removeEventListener('pointerup', this.pointerUp);
    this.pendingNavigation?.(false);
    this.pendingNavigation = undefined;
    this.editor?.destroy();
    if (this.editor) this.destroyed++;
    this.editor = undefined;
    this.projection = undefined;
    this.cache.clear();
    this.debugPublicationBytes = 0;
    this.tableReceiveAccounting = {
      wireBytes: 0,
      decodeBufferBytes: 0,
      decodedOwnerBytes: 0,
      previousProjectionBytes: 0,
      cacheBeforeBytes: 0,
      cachePeakBytes: 0,
    };
    this.tableScrollRequest = undefined;
    this.tableCoverageRequest = undefined;
    this.tableViewTarget = undefined;
    this.tableTargetCandidate = undefined;
    this.tableCoverageState = undefined;
    this.tableCoverageFailure = undefined;
    this.tableCoverage = { status: 'unmeasured', attempts: 0, deficit: 0, sourceUnits: 0 };
  }
}
