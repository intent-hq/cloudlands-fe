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
import { cloneTableWindow } from './table-payload';
import { Editor, Extension, type CommandProps } from '@tiptap/core';
import { Plugin, TextSelection, EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { createEditorConfig } from '$lib/utils/editor-config';
import { bytes } from './bounded-note-service';
import {
  LIMITS,
  SourceJournal,
  mapSelection,
  mapPoint,
  type Selection,
  type Splice,
} from './source-journal';
import { SourceProjection, openMark, closeMark, type InlineContext } from './source-projection';
import { continuationWindow, CONTINUATION } from './continuation-window';
import { layoutTable } from './table-layout';
import { CellSelection, tableEditingKey } from '@tiptap/pm/tables';

/** Test-only logical document. Production editor, APIs, annotations and size guard are unchanged. */
export class DocumentSession {
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
        const anchorsBefore = structuredClone(this.service.anchors);
        const after = this.service.stageTablePaste(before, manifest.id, this.editor!);
        this.service.record(
          {
            changes: [],
            before,
            after,
            anchorsBefore,
            anchorsAfter: structuredClone(this.service.anchors),
          },
          false,
        );
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
      const anchorsBefore = structuredClone(this.service.anchors);
      const after = this.service.stageTableCut(before, publication.id, this.editor!.schema);
      this.service.record(
        {
          changes: [],
          before,
          after,
          anchorsBefore,
          anchorsAfter: structuredClone(this.service.anchors),
        },
        false,
      );
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
  projection?: SourceProjection;
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
    this.continueNearEdge();
  };
  private cache = new Map<string, string>();
  private navigation = 0;
  private suppress = false;
  private prevTime = 0;
  private prevComposition: number | undefined;
  private prevRange?: [number, number];
  private pendingFetch?: Promise<void>;
  private pendingNavigation?: (accepted: boolean) => void;
  private rollbackState?: EditorState;
  delayFetch?: () => Promise<void>;
  constructor(
    readonly service: SourceJournal,
    private host: HTMLElement,
    private changed = () => {},
  ) {
    host.addEventListener('pointerdown', this.pointerDown);
    document.addEventListener('pointerup', this.pointerUp);
  }
  private project(source: string, start: number, table?: InlineContext['table']) {
    if (bytes(source) > LIMITS.active)
      throw new Error('Proof projection exceeds experiment budget');
    this.parsedBytes += bytes(source);
    this.maxParsedBytes = Math.max(this.maxParsedBytes, bytes(source));
    const context: InlineContext = table
      ? {
          revision: table.revision,
          from: start,
          to: start + source.length,
          before: [],
          after: [],
          table,
        }
      : this.service.inlineContext(start, start + source.length);
    if (context.revision !== this.service.revision)
      throw new Error('Stale inline context response');
    this.maxSourceContextBytes = Math.max(
      this.maxSourceContextBytes,
      bytes(source) + bytes(JSON.stringify(context)),
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
      bytes(source) +
        bytes(JSON.stringify(context.fences ?? [])) +
        bytes(JSON.stringify(context.lists ?? [])) +
        bytes(JSON.stringify(context.seams ?? [])) +
        bytes(context.before.map(openMark).join('') + context.after.map(closeMark).join('')),
    );
    return new SourceProjection(source, start, context);
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
  maxTableTransferPageBytes = 0;
  maxTableTransferBytes = 0;
  maxTableAssemblyBytes = 0;
  maxTableResidentAndAssemblyBytes = 0;
  private receiveTable(pages: TablePage[] | undefined) {
    if (!pages) return undefined;
    const encodedBytes = pages.reduce((n, p) => n + bytes(JSON.stringify(p)), 0);
    const assemblyBytes = pages.reduce((n, p) => n + bytes(p.payload), 0);
    this.maxTableTransferBytes = Math.max(this.maxTableTransferBytes, encodedBytes);
    this.maxTableAssemblyBytes = Math.max(this.maxTableAssemblyBytes, encodedBytes + assemblyBytes);
    const window = decodeTablePages(pages, this.service.revision);
    this.maxTableResidentAndAssemblyBytes = Math.max(
      this.maxTableResidentAndAssemblyBytes,
      encodedBytes +
        assemblyBytes +
        bytes(JSON.stringify(window)) +
        bytes(this.projection?.source ?? '') +
        bytes(JSON.stringify(this.projection?.context ?? {})),
    );
    for (const page of pages) {
      const payload = JSON.stringify(page);
      this.maxTableTransferPageBytes = Math.max(this.maxTableTransferPageBytes, bytes(payload));
      const key = `table:${page.revision}:${window.from}:${window.cells[0].first}:${page.index}`;
      this.cache.delete(key);
      this.cache.set(key, payload);
      while (
        this.cache.size > LIMITS.cachePages ||
        [...this.cache.values()].reduce((n, v) => n + bytes(v), 0) > TABLE_ACTIVE_BYTES
      )
        this.cache.delete(this.cache.keys().next().value!);
    }
    return window;
  }
  private readWindow(id: number, position?: number, selection = this.selection) {
    const at = position ?? this.service.start(id);
    const scroller = this.host.parentElement;
    const preferred = position === selection.head ? selection.table?.head : undefined;
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
          },
          preferred,
          selection.table,
        )
      : this.service.tableWindowPages(at, undefined, preferred, undefined, selection.table);
    const table = this.receiveTable(pages);
    if (table) {
      const source = table.cells.map((c) => c.raw).join('');
      const from = table.cells[0].first,
        to = table.cells.at(-1)!.last;
      this.inFlightBytes += bytes(source);
      this.maxInFlightBytes = Math.max(this.maxInFlightBytes, this.inFlightBytes);
      return { from, to, source, table, continuation: true };
    }
    const bounds = continuationWindow(this.service, id, position);
    bounds.from = this.service.inlineBoundary(bounds.from, 1);
    bounds.to = this.service.inlineBoundary(bounds.to, -1);
    Object.assign(bounds, this.service.listWindow(bounds.from, bounds.to, position ?? bounds.from));
    const source = this.readRange(bounds.from, bounds.to);
    this.inFlightBytes += bytes(source);
    this.maxInFlightBytes = Math.max(this.maxInFlightBytes, this.inFlightBytes);
    return { ...bounds, source, table: undefined };
  }
  /** A source coordinate identifies a continuation; page edges never enter the source. */
  seek(position: number, restore = true) {
    return this.show(
      Math.min(this.service.locate(position).id, Math.max(0, this.service.count - 2)),
      restore,
      position,
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
          } else accepted = document.execCommand(current.command, false, current.text);
          await Promise.resolve();
          this.replayingInput = false;
          this.replayTime = undefined;
          if (!accepted || this.error) throw new Error(this.error || 'Native input replay failed');
        }
        this.service.acknowledgeInput();
        this.residentInputBytes = 0;
      }
    } catch (error) {
      // Unacknowledged intent remains in the backing inbox for inspection/recovery.
      this.error = String(error);
    } finally {
      this.replayingInput = false;
      this.replayTime = undefined;
      this.residentInputBytes = 0;
      this.drainingInput = false;
      this.changed();
    }
  }
  private tableTabAtEnd = false;
  private tableTabDestination?: Selection;
  tableViewport = 0;
  private tableScroller?: HTMLElement;
  private tableScrollRequest?: { position: number; top: number; left: number };
  private tableFragmentScrollTop = 0;
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
  }
  private tableScroll = () => {
    const table = this.projection?.table?.window,
      scroller = this.tableScroller;
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
    this.tableScrollRequest = {
      position: at.source,
      top: Math.max(0, scroller.scrollTop - this.tableOriginY),
      left: Math.max(0, scroller.scrollLeft - this.tableOriginX),
    };
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
      this.tableScrollRequest = undefined;
      if (atEnd && this.projection?.table)
        scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
      this.tableFragmentScrollTop = scroller.scrollTop;
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
          bytes(this.projection!.source) + bytes(JSON.stringify(this.projection!.context));
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
      this.tableFontObserver = new MutationObserver(() => {
        if (
          !this.pointerSelecting &&
          !editor.isDestroyed &&
          this.editor === editor &&
          this.projection?.table?.window.geometry?.font !== this.tableFont()
        )
          this.resizeTable(this.tableViewport);
      });
      this.tableFontObserver.observe(editor.view.dom, {
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }
    if (before && scroller) this.preserveTableAnchor(before);
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
  private continueNearEdge() {
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
      const pageBlocks =
        cell?.blocks &&
        point &&
        ((point.block - cell.blocks[0].index < 2 && cell.blocks[0].index > 0) ||
          (cell.blocks.at(-1)!.index - point.block < 2 &&
            cell.blocks.at(-1)!.index + 1 < (cell.blockCount ?? 0)) ||
          cell.blocks.length > 8);
      const pageText =
        cell &&
        ((cell.first > cell.body && head - cell.first < 32) ||
          (cell.last < cell.end && cell.last - head < 32));
      if (!pageBlocks && !pageText) return;
      this.continuationQueued = true;
      queueMicrotask(() => {
        this.continuationQueued = false;
        if (this.editor && !this.editor.view.composing)
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
    queueMicrotask(() => {
      this.continuationQueued = false;
      if (this.drainingInput || !this.editor || this.editor.view.composing) return;
      void this.show(this.active, true, this.selection.head, true);
    });
  }
  async show(
    id: number,
    restore = false,
    position?: number,
    preserveView = false,
    requestedSelection?: Selection,
  ) {
    if (this.editor?.view.composing) {
      this.error = 'Composition pins current view';
      this.changed();
      return false;
    }
    const ticket = ++this.navigation;
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
    const window = this.readWindow(id, position, requestedSelection);
    try {
      const next = this.project(window.source, window.from, window.table);
      if (next.table) {
        try {
          tableNodeBudget(next.content);
        } catch (error) {
          this.error = String(error);
          this.changed();
          return false;
        }
      }
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
        this.suppress = true;
        try {
          const tr = editor.state.tr.replaceWith(
            0,
            editor.state.doc.content.size,
            editor.schema.nodeFromJSON(next.content).content,
          );
          const restored = requestedSelection ?? this.selection;
          tr.setSelection(
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
        return true;
      }
      this.editor?.destroy();
      if (this.editor) this.destroyed++;
      this.active = id;
      this.windowEnd = window.to;
      this.continuation = window.continuation;
      this.projection = next;
      const decorations = (state: EditorState) => {
        const p = this.projection!;
        const result = this.service.annotations(
          p.start,
          p.start + p.source.length,
          this.service.revision,
          this.service.generation,
        );
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
          ...result.items.flatMap((a) => {
            const from = p.pmAt(Math.max(a.from, p.start)),
              to = p.pmAt(Math.min(a.to, p.start + p.source.length), -1);
            return from < to ? [Decoration.inline(from, to, { 'data-proof-comment': a.id })] : [];
          }),
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
          const p = this.projection?.table,
            logical = this.selection.table;
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
        extensions: [...extensions, annotations],
        onUpdate: () => {},
        onSelectionUpdate: () => {},
        onTransaction: ({ transaction, appendedTransactions }) =>
          this.accept([transaction, ...(appendedTransactions ?? [])]),
        editorProps: {
          ...config.editorProps,
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
                  bytes(p.source) + bytes(JSON.stringify(p.context)) + 2 * bytes(event.data ?? '') >
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
            const globalRange =
              !p.table &&
              (this.selection.anchor < p.start ||
                this.selection.head < p.start ||
                this.selection.anchor > p.start + p.source.length ||
                this.selection.head > p.start + p.source.length);
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
          : this.selection.head < window.from ||
            this.selection.head > window.from + window.source.length)
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
      if (!restore && this.projection.table && this.tableScroller && this.tableScrollRequest) {
        // Destroying the old DOM temporarily shrinks the scroll canvas. Restore
        // the requested viewport after mounting/layout, including fresh sessions
        // that have no focused native caret to recover the scroll position.
        this.tableScroller.scrollLeft = this.tableScrollRequest.left + this.tableOriginX;
        this.tableScroller.scrollTop = this.tableScrollRequest.top + this.tableOriginY;
      }
      this.error = '';
      this.changed();
      return true;
    } finally {
      this.inFlightBytes -= bytes(window.source);
    }
  }
  private renderSelection() {
    const p = this.projection!,
      editor = this.editor!;
    const selection =
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
    if (cells && p.table) {
      const a = p.table.entries.find((e) => e.pm === selection.$anchorCell.pos),
        h = p.table.entries.find((e) => e.pm === selection.$headCell.pos);
      anchor = a ? { cell: a.cell.from, block: 0, offset: 0 } : undefined;
      head = h ? { cell: h.cell.from, block: 0, offset: 0 } : undefined;
    }
    return {
      ...(anchor && head
        ? { table: { anchor, head, kind: cells ? ('cell' as const) : ('text' as const) } }
        : {}),
      anchor: p.sourceAt(selection.anchor),
      head: p.sourceAt(selection.head),
      affinity: selection.anchor <= selection.head ? 1 : -1,
      revision: this.service.revision,
    };
  }
  private accept(transactions: Transaction[]) {
    if (this.suppress) return;
    const command = transactions.find((tr) => tr.getMeta('proofLogicalTableCommand'));
    if (command) {
      const before = structuredClone(this.selection);
      try {
        const after = this.service.atomic(() => {
          this.service.beginChanges();
          const anchorsBefore = structuredClone(this.service.anchors);
          const after = this.service.stageLogicalTableCommand(
            command.getMeta('proofLogicalTableCommand'),
            this.editor!,
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
          this.service.record(
            {
              changes: [],
              before,
              after,
              anchorsBefore,
              anchorsAfter: structuredClone(this.service.anchors),
            },
            false,
          );
          return after;
        });
        this.tableTabAtEnd = false;
        this.tableTabDestination = undefined;
        this.selection = after;
        this.selectionGeneration++;
        this.prevTime = 0;
        this.cache.clear();
        this.error = '';
        queueMicrotask(() => {
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
          const anchorsBefore = structuredClone(this.service.anchors);
          const result = this.service.stageLogicalTableSplit(
            logicalSplit.getMeta('proofLogicalTableSplit'),
          );
          const after: Selection = { ...before, revision: result.revision };
          if (after.table?.kind === 'cell') {
            after.table = { ...after.table, head: { cell: result.last, block: 0, offset: 0 } };
            after.head = result.lastSource;
          }
          this.service.record(
            {
              changes: [],
              before,
              after,
              anchorsBefore,
              anchorsAfter: structuredClone(this.service.anchors),
            },
            false,
          );
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
    const old = {
      projection: this.projection,
      windowEnd: this.windowEnd,
      selection: this.selection,
      prevTime: this.prevTime,
      prevComposition: this.prevComposition,
      prevRange: this.prevRange,
      acceptedRoots: this.acceptedRoots,
      acceptedAppended: this.acceptedAppended,
    };
    try {
      this.service.atomic(() => {
        for (let index = 0; index < transactions.length; index++) {
          const tr = transactions[index];
          if (!tr.docChanged) {
            if (tr.selectionSet) {
              this.selection = this.tableTabDestination ?? this.fromPM(tr.selection);
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
          if (
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
            if (this.prevRange && start <= this.prevRange[1] && end >= this.prevRange[0])
              adjacent = true;
          });
          const anchorsBefore = structuredClone(this.service.anchors);
          const history =
            tr.getMeta('addToHistory') !== false &&
            transactions[0].getMeta('addToHistory') !== false;
          this.service.beginChanges();
          let oldStart = this.projection!.start;
          const tableBatch = this.projection!.table;
          const listBatch = !!this.projection!.list || !!tableBatch;
          for (let n = 0; n < (listBatch ? 1 : tr.steps.length); n++) {
            let fences: NonNullable<InlineContext['fences']> = [];
            // Native joins may have intermediate structures with no Markdown representation.
            // Admit the final list document atomically using every step's token mapping.
            const splices = tableBatch
              ? tableBatch.translateTransaction(tr, (pm, affinity) =>
                  this.projection!.sourceAt(pm, affinity),
                )
              : listBatch
                ? this.projection!.list!.translateTransaction(tr)
                : this.projection!.translate(tr.steps[n], tr.docs[n], (next) => {
                    fences = next;
                  });
            if (tableBatch?.codeChanges.length)
              splices.push(...this.service.tableCodePatches(tableBatch.codeChanges));
            if (tableBatch?.structural) {
              const table = this.service.stageTableStructure(
                tableBatch.window,
                tableBatch.structural,
                history,
              );
              this.projection = this.project(
                table.cells.map((c) => c.raw).join(''),
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
              const listSeams = this.projection!.list?.seams;
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
                this.projection!.list?.indentation,
                (splice) => {
                  oldStart = mapPoint(oldStart, splice, -1);
                  this.windowEnd = mapPoint(this.windowEnd, splice);
                  if (!history && this.prevRange)
                    this.prevRange = [
                      mapPoint(this.prevRange[0], splice),
                      mapPoint(this.prevRange[1], splice),
                    ];
                },
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
                if (trailing !== (tableBatch.window.trailing !== false))
                  this.service.stageTableTrailing(
                    tableBatch.window.from,
                    trailing,
                    this.service.revision,
                    false,
                  );
              }
              if (this.projection!.table) {
                const retained = cloneTableWindow(tableBatch!.window);
                for (const splice of splices)
                  for (const cell of retained.cells) {
                    cell.first = mapPoint(cell.first, splice, -1);
                    cell.last = mapPoint(cell.last, splice, 1);
                  }
                const target = mapPoint(before.head, splices[0] ?? { from: 0, to: 0, insert: '' });
                const table = this.receiveTable(this.service.tableWindowPages(target, retained))!;
                this.projection = this.project(
                  table.cells.map((c) => c.raw).join(''),
                  table.cells[0].first,
                  table,
                );
                this.windowEnd = table.cells.at(-1)!.last;
              } else
                this.projection = this.project(this.readRange(oldStart, this.windowEnd), oldStart);
            }
            if (
              (this.projection.list || this.projection.table) &&
              !this.editor!.schema.nodeFromJSON(this.projection.content).eq(
                listBatch ? tr.doc : tr.steps[n].apply(tr.docs[n]).doc!,
              )
            ) {
              throw new Error('Translated source differs from accepted document');
            }
          }
          const terminalAppend =
            tableBatch &&
            !tr.selectionSet &&
            tr.before.childCount === 1 &&
            tr.doc.childCount === 2 &&
            tr.doc.lastChild!.type.name === 'paragraph' &&
            !tr.doc.lastChild!.content.size &&
            tr.before.firstChild!.eq(tr.doc.firstChild!);
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
          if (history)
            this.service.record(
              {
                changes: [],
                before,
                after,
                anchorsBefore,
                anchorsAfter: structuredClone(this.service.anchors),
              },
              group,
            );
          if (history) {
            this.prevRange = undefined;
            for (let m = tr.mapping.maps.length - 1; m >= 0 && !this.prevRange; m--) {
              tr.mapping.maps[m].forEach((_from, _to, from, to) => {
                this.prevRange = [this.projection!.sourceAt(from), this.projection!.sourceAt(to)];
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
      this.resizeTable(this.tableViewport);
      this.error = '';
      // Only source changes invalidate anchors. Refreshing during a selectionchange can
      // race the browser's next native selection update.
      if (transactions.some((tr) => tr.docChanged)) this.editor?.view.setProps({});
      this.changed();
      this.continueNearEdge();
    } catch (error) {
      this.tableTabAtEnd = false;
      this.tableTabDestination = undefined;
      Object.assign(this, old);
      if (this.rollbackState) this.editor!.view.updateState(this.rollbackState);
      this.error = String(error);
      this.rejectedTransactions++;
      this.lastRejection = this.error.slice(0, 512);
      this.changed();
    }
  }
  async history(redo = false) {
    const index = redo ? this.service.cursor : this.service.cursor - 1;
    if (index < 0 || index >= this.service.depth) return false;
    const event = this.service.event(index);
    this.service.atomic(() => {
      this.service.bookmark(index, redo ? 'before' : 'after', this.selection);
      for (const change of this.service.changes(index, !redo)) this.service.replay(change, redo);
      this.service.anchors = structuredClone(redo ? event.anchorsAfter : event.anchorsBefore);
      this.service.cursor += redo ? 1 : -1;
    });
    this.selection = { ...(redo ? event.after : event.before), revision: this.service.revision };
    this.prevTime = 0;
    this.cache.clear();
    await this.seek(this.selection.head);
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
    const before = { ...this.selection },
      anchorsBefore = structuredClone(this.service.anchors);
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
      this.service.record(
        {
          changes: [],
          before,
          after,
          anchorsBefore,
          anchorsAfter: structuredClone(this.service.anchors),
        },
        false,
      );
      return after;
    });
    this.selection = after;
    this.prevTime = 0;
    this.cache.clear();
    await this.seek(from);
  }
  remote(splice: Splice) {
    const table = !!this.projection?.table;
    const oldStart = this.projection!.start;
    this.service.atomic(() => {
      this.service.validateTableRemote(splice);
      this.service.apply(splice);
      this.service.rebase(splice);
    });
    this.selection = mapSelection(this.selection, splice, this.service.revision);
    this.windowEnd = mapPoint(this.windowEnd, splice);
    if (this.prevRange)
      this.prevRange = [mapPoint(this.prevRange[0], splice), mapPoint(this.prevRange[1], splice)];
    this.cache.clear();
    if (table) {
      void this.seek(this.selection.head);
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
      this.changed();
    } else void this.seek(this.selection.head);
  }
  snapshot() {
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
    const tableBound =
      this.projection?.table && this.editor ? tableResourceBound(this.editor.getJSON()) : undefined;
    const tableDOM =
      tableBound && this.editor ? measureTableDOM(this.editor.view.dom, tableBound) : undefined;
    return {
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
      tableResourceBound: tableBound,
      tableDomElements: tableDOM?.elements ?? 0,
      tableDomTextNodes: tableDOM?.textNodes ?? 0,
      maxTableTransferPageBytes: this.maxTableTransferPageBytes,
      maxTableTransferBytes: this.maxTableTransferBytes,
      maxTableAssemblyBytes: this.maxTableAssemblyBytes,
      maxTableResidentAndAssemblyBytes: this.maxTableResidentAndAssemblyBytes,
      tableColumnWidth: this.tableColumnWidth,
      tableCells: this.projection?.table?.entries.length ?? 0,
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
      tableContextBytes: bytes(JSON.stringify(this.projection?.context?.table ?? {})),
      maxTableWindowBytes: this.service.maxTableWindowBytes,
      backingTableScannedBytes: this.service.backingTableScannedBytes,
      maxSeamMetadataBytes: this.maxSeamMetadataBytes,
      maxSeamAdmissionBytes: this.maxSeamAdmissionBytes,
      maxResidentAndInFlightSeamBytes: this.maxResidentAndInFlightSeamBytes,
      seamMetadataBytes: bytes(JSON.stringify(this.projection?.context?.seams ?? [])),
      listMetadataBytes: bytes(JSON.stringify(this.projection?.context?.lists ?? [])),
      syntheticListParents: this.projection?.list?.synthetic.length ?? 0,
      listProjectionPayloadBytes: bytes(
        JSON.stringify({
          positions: [...(this.projection?.list?.positions ?? [])],
          ends: [...(this.projection?.list?.ends ?? [])],
          boundaries: [...(this.projection?.list?.boundaries ?? [])],
          tokens: this.projection?.list?.tokens,
          indentation: this.projection?.list?.indentation,
          parts: [
            ...(this.projection?.list?.entries.map((e) => e.part) ?? []),
            ...(this.projection?.list?.prose.map((e) => e.part) ?? []),
          ].map((part) => ({
            source: part?.source,
            content: part?.content,
            positions: [...(part?.positions ?? [])],
            ends: [...(part?.ends ?? [])],
            boundaries: [...(part?.boundaries ?? [])],
            tokens: part?.tokens,
            marks: part?.marks,
          })),
        }),
      ),
      maxHighlightBytes: this.maxHighlightBytes,
      highlightCalls: this.highlightCalls,
      codeMetadataBytes: bytes(JSON.stringify(this.projection?.code ?? [])),
      residentInputBytes: this.residentInputBytes,
      maxResidentInputBytes: this.maxResidentInputBytes,
      continuation: this.continuation,
      windowFrom: this.projection?.start,
      windowTo: this.windowEnd,
      inlineContextBytes: bytes(JSON.stringify(this.projection?.context ?? {})),
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
      source: this.projection?.source,
      reads: this.service.reads,
      maxSourceRead: this.service.maxRead,
      // Count duplicated source/text representations explicitly; these are serialized payload
      // counts, not a heap measurement. Mock backing source and oracle live elsewhere.
      sourceReplicaPayloadBytes:
        bytes(this.projection?.source ?? '') +
        (this.projection?.list?.entries.reduce((n, e) => n + bytes(e.part?.source ?? ''), 0) ?? 0) +
        (this.projection?.list?.prose.reduce((n, e) => n + bytes(e.part.source), 0) ?? 0) +
        bytes(JSON.stringify(this.projection?.context ?? {})) +
        bytes(JSON.stringify(this.projection?.code ?? [])) +
        [...this.cache.values()].reduce((n, page) => n + bytes(page), 0) +
        this.inFlightBytes +
        (this.projection?.tokens.reduce((n, t) => n + bytes(t.raw) + bytes(t.text), 0) ?? 0) +
        bytes(JSON.stringify(this.projection?.content ?? {})) +
        bytes(JSON.stringify(this.editor?.getJSON() ?? {})) +
        bytes(JSON.stringify(this.editor?.options.content ?? {})),
      calls: this.service.logs,
      created: this.created,
      destroyed: this.destroyed,
      mounted: this.created - this.destroyed,
      pmNodes: nodes + Number(!!this.projection?.table),
      pmBytes: bytes(JSON.stringify(this.editor?.getJSON() ?? {})),
      pluginCount: this.editor?.state.plugins.length ?? 0,
      nativeHistoryPlugins:
        this.editor?.state.plugins.filter((p) =>
          String((p as unknown as { key: string }).key).startsWith('history$'),
        ).length ?? 0,
      projectionJsonBytes: bytes(JSON.stringify(this.projection?.content ?? {})),
      editorContentOptionBytes: bytes(JSON.stringify(this.editor?.options.content ?? {})),
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
      annotationPayloadBytes: bytes(JSON.stringify(this.service.anchors)),
      rendererJournalPages: 0,
      activeBytes: bytes(this.projection?.source ?? ''),
      cachePages: this.cache.size,
      cacheBytes: [...this.cache.values()].reduce((n, p) => n + bytes(p), 0),
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
  }
}
