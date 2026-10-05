import { sameNoteScope } from '$lib/client/note-pages';
import type { NoteViewCoordinates } from './note-view-coordinates';
import type { Workspace } from '$shared/types';
import { Editor, Extension } from '@tiptap/core';
import { AllSelection, TextSelection, EditorState } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { CommentAnchor } from '$lib/components/tiptap/CommentAnchor';
import { createEditorConfig } from '$lib/utils/editor-config';
import { NoteNativeLifetime } from './note-native-lifetime';
import { logger } from '$lib/utils/client-logger';
import { measureNoteProjection } from './note-view-cost';
import { validateNoteNativeOutput } from './note-native-output-validation';
import { measureNoteDom } from './note-dom-cost';
import { projectNoteWindow } from './note-window-projection';
import type { SourceProjection } from './projection/source-projection';
import { NOTE_WINDOW_LIMITS, type NoteWindow } from './note-window-reader';
import type { NoteResourceCost } from './note-resource-ledger';
import { createNoteTransactionRelay, type NoteTransactionOwner } from './note-transaction-relay';

import { NoteEditAuthority } from './editing/note-edit-authority';
import {
  captureNoteSelectionMarkdown,
  type NoteSelectionMarkdownIdentity,
} from './editing/note-selection-markdown-capture';

import {
  captureNoteRenderedSearch,
  type NoteRenderedSearchInput,
} from './editing/note-rendered-search-capture';
import type { NoteRenderedSearchPage } from './editing/note-rendered-search-results';
import {
  captureNoteMarker,
  isNoteMarkerCapture,
  noteMarkerCaptureLimits,
  UnsupportedNoteMarkerCapture,
  type NoteMarkerCapture,
  type NoteMarkerCaptureInput,
} from './editing/note-marker-capture';
import {
  captureNoteMarkerSelection,
  isNoteMarkerSelectionCapture,
} from './editing/note-marker-selection-capture';
import type { NoteSourceSelection } from './note-source-selection';
export type { NoteSourceSelection } from './note-source-selection';

export interface NoteViewEditing {
  /** Resolve a current document-owned authority for this mounted window. Binding is
   * pure; an unsupported or stale window remains read-only. */
  bind(
    window: NoteWindow,
    projection: SourceProjection,
    doc: PMNode,
  ): NoteTransactionOwner | undefined;
  /** A retained prepared context belongs to one pending/mounted native view. */
  borrow?(window: NoteWindow): { bind: NoteViewEditing['bind']; release(): void };
  selectionChanged?(selection: NoteSourceSelection): void;
  undo(): void;
  redo(): void;
}
export interface NoteWindowViewOptions {
  workspace?: Workspace;
  seek(position: number): void;
  selectionChanged(selection: NoteSourceSelection): void;
  fullOperation(kind: 'copy' | 'search' | 'selectAll', selection: NoteSourceSelection): void;
  editing?: NoteViewEditing;
  changed?(): void;
  failed?(): void;
  /** Retain the actual admitted DATA graph until this view releases its reference. */
  retainWindow?(window: NoteWindow): () => void;
}
/** One disposable native view. No source backing, page cache, persistence or per-view history.
 * Geometry, Editor/DOM and in-progress composition are its only runtime ownership. */
/** Admitted reader data only, not arbitrary proxies. Never invoke context
 * getters or serializers: a later owner callback may install either. */
function markerContextWitness(context: NoteWindow['context']) {
  const refs: { object: object; keys: string[]; values: unknown[]; array: boolean }[] = [];
  let bytes = 0;
  const visit = (value: unknown, depth: number): unknown => {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      if (typeof value === 'string' && value.length > NOTE_WINDOW_LIMITS.contextBytes)
        throw new Error('Marker context exceeds budget');
      if (typeof value === 'number' && !Number.isFinite(value))
        throw new Error('Invalid marker context number');
      bytes += new TextEncoder().encode(JSON.stringify(value)).length;
      if (bytes > NOTE_WINDOW_LIMITS.contextBytes) throw new Error('Marker context exceeds budget');
      return value;
    }
    if (!value || typeof value !== 'object' || depth > 2)
      throw new Error('Invalid marker context data');
    const array = Array.isArray(value),
      proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      throw new Error('Invalid marker context prototype');
    if (Object.getOwnPropertyDescriptor(value, 'toJSON'))
      throw new Error('Executable marker context');
    const length = array ? Object.getOwnPropertyDescriptor(value, 'length') : undefined;
    if (
      array &&
      (!length ||
        !('value' in length) ||
        !Number.isSafeInteger(length.value) ||
        length.value < 0 ||
        length.value > NOTE_WINDOW_LIMITS.descriptors)
    )
      throw new Error('Marker context count exceeded');
    const keys = Reflect.ownKeys(value);
    if (keys.length > (array ? length!.value + 1 : 16) || keys.some((k) => typeof k !== 'string'))
      throw new Error('Marker context fields exceeded');
    const fields = keys as string[],
      values: unknown[] = [];
    if (
      array &&
      (fields.length !== length!.value + 1 ||
        fields.some(
          (k) => k !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= length!.value),
        ))
    )
      throw new Error('Invalid marker context array');
    bytes += 2;
    for (const key of fields) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !('value' in d) || (key !== 'length' && !d.enumerable))
        throw new Error('Executable marker context property');
      values.push(d.value);
      if (array && key === 'length') continue;
      bytes += 1 + (array ? 0 : new TextEncoder().encode(JSON.stringify(key)).length + 1);
      visit(d.value, depth + 1);
    }
    refs.push({ object: value, keys: fields, values, array });
    return undefined;
  };
  visit(context, 0);
  if (bytes > NOTE_WINDOW_LIMITS.contextBytes) throw new Error('Marker context exceeds budget');
  return () => {
    for (const { object, keys, values, array } of refs) {
      const proto = Object.getPrototypeOf(object);
      if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
        return false;
      if (Object.getOwnPropertyDescriptor(object, 'toJSON')) return false;
      // Bounded enumeration aborts before traversal of any unexpected field.
      let count = 0;
      for (const key in object) {
        if (!Object.hasOwn(object, key) || ++count > keys.length || !keys.includes(key))
          return false;
      }
      if (count + (array ? 1 : 0) !== keys.length) return false;
      for (let i = 0; i < keys.length; i++) {
        const d = Object.getOwnPropertyDescriptor(object, keys[i]);
        if (
          !d ||
          !('value' in d) ||
          d.value !== values[i] ||
          (keys[i] !== 'length' && !d.enumerable)
        )
          return false;
      }
    }
    return true;
  };
}

export interface NoteReadingSurface {
  /** Shared renderer admission policy supplied by the application rollout owner. */
  resourceLimits: NoteResourceCost;
  /** Supplied by the document-operation owner only after rollout prerequisites pass.
   * Never use visible editor text as the implementation of this operation. */
  copyDocument(): Promise<void>;
  /** Revoke an outstanding whole-source copy when this surface retires. Physical
   * IO and unpublished sink cleanup keep their resource lease until settled. */
  cancelCopy?(): void;
  /** Native selection capture and bounded staged output; absent until its
   * configured-schema, transport and platform sink prerequisites are supplied. */
  copySelection?(): Promise<'copied' | 'noCopy'>;
  cancelSelectionCopy?(): void;
  /** Explicit captured native rendered search; callback settlement retains DATA.
   * Page references are borrowed until callback settlement; callers retaining
   * them afterward must separately admit/copy their state.
   * A supplied operation is independent of normal route/capability activation. */
  searchRendered?(
    query: string,
    consume: (page: NoteRenderedSearchPage) => Promise<void>,
  ): Promise<void>;
  cancelRenderedSearch?(): void;
  /** Explicit clean marker source operation; callback text is borrowed until
   * settlement and never establishes server marker provenance by itself. */
  readMarkerSource?(position: number, consume: (text: string) => Promise<void>): Promise<void>;
  cancelMarkerSource?(): void;
  selectionChanged(selection: NoteSourceSelection): void;
  fullOperation: NoteWindowViewOptions['fullOperation'];
  editing?: NoteViewEditing;
  prepareEditing?(window: NoteWindow): {
    ready: Promise<NoteViewEditing | undefined>;
    cancel(): void;
    release(): Promise<void>;
    /** Retire navigation delivery while existing native borrowers finish. */
    retire?(): Promise<void>;
  };
  ready?(view: NoteWindowView): void;
}
interface WindowLease {
  editing?: NoteViewEditing;
  bind?: NoteViewEditing['bind'];
  borrowed: boolean;
  retain(): () => void;
  release(): void;
}
export class NoteWindowView {
  editor?: Editor;
  private selectionBorrowEpoch = 0;
  private selectionBorrowExhausted = false;
  private restoreSelectionObserver?: () => void;
  private readonly selectionBorrowListeners = new Set<() => void>();
  get selectionCaptureGeneration() {
    return this.selectionBorrowEpoch;
  }
  private invalidateSelectionBorrows() {
    if (this.selectionBorrowEpoch === Number.MAX_SAFE_INTEGER) this.selectionBorrowExhausted = true;
    else this.selectionBorrowEpoch++;
    for (const notify of [...this.selectionBorrowListeners]) notify();
  }
  /** Caller admits capture/borrow DATA before entry and supplies an irreversible
   * operation-current predicate. Local native/lifecycle loss notifies subscribers
   * immediately; external operation changes remain the owner's subscription.
   * Release only after dependent IO settles, even after current() becomes false. */
  borrowSelectionMarkdown(
    identity: NoteSelectionMarkdownIdentity,
    operationCurrent: () => boolean,
  ) {
    return this.borrowNativeCapture(identity, operationCurrent, (editor, authority, current) =>
      captureNoteSelectionMarkdown(editor.view, {
        authority,
        identity,
        selection: this.getSelection(),
        current,
      }),
    );
  }
  borrowRenderedSearch(
    identity: NoteSelectionMarkdownIdentity,
    query: NoteRenderedSearchInput['query'],
    operationCurrent: () => boolean,
  ) {
    return this.borrowNativeCapture(
      identity,
      operationCurrent,
      (editor, authority, current) =>
        captureNoteRenderedSearch(editor.view, {
          authority,
          identity,
          query,
          selection: this.getSelection(),
          current,
        }),
      true,
    );
  }
  /** Selection output uses the read-only marker lease, never an editing authority.
   * Every executable owner check precedes the producer's final native proof. */
  borrowMarkerSelectionMarkdown(
    identity: NoteSelectionMarkdownIdentity,
    operationCurrent: () => boolean,
  ) {
    let snapshot:
      | { editor: Editor; projection: SourceProjection; identity: NoteSelectionMarkdownIdentity }
      | undefined;
    let marker: ReturnType<NoteWindowView['borrowMarkerOccurrence']> | undefined;
    {
      const editor = this.editor,
        projection = this.committedProjection;
      const paragraph = editor?.state.doc.firstChild;
      if (!editor || !projection || !paragraph || paragraph.childCount !== 3)
        // i18n-ignore (internal typed refusal; not rendered UI text)
        throw new UnsupportedNoteMarkerCapture('Unsupported marker selection context');
      const position = 1 + paragraph.child(0).nodeSize;
      snapshot = { editor, projection, identity };
      marker = this.borrowMarkerOccurrence(identity, position, operationCurrent);
    }
    let captured: ReturnType<typeof captureNoteMarkerSelection> | undefined;
    let lost = false,
      released = false;
    const listeners = new Set<() => void>();
    const lose = () => {
      if (lost) return;
      lost = true;
      captured = undefined;
      snapshot = undefined;
      marker?.retire();
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          logger.error('Failed to notify marker selection loss', error);
        }
      }
    };
    const prove = () => {
      const s = snapshot,
        borrowed = marker;
      if (!s || !borrowed) throw new Error('Marker selection borrow retired');
      return captureNoteMarkerSelection(s.editor.view, {
        projection: s.projection,
        identity: s.identity,
        selection: this.getSelection(),
        current: borrowed.current,
      });
    };
    const current = () => {
      if (lost || released || !captured || !snapshot) return false;
      try {
        const s = snapshot;
        // The helper calls marker.current before its final mapping validation.
        // Do not add an executable owner callback after that proof.
        const proof = prove();
        if (
          !isNoteMarkerSelectionCapture(proof) ||
          JSON.stringify(proof) !== JSON.stringify(captured) ||
          this.editor !== s.editor ||
          this.committedProjection !== s.projection ||
          snapshot !== s
        )
          lose();
      } catch {
        lose();
      }
      return !lost && !released;
    };
    let unsubscribe: (() => void) | undefined;
    const release = () => {
      if (released) return;
      released = true;
      const stop = unsubscribe;
      unsubscribe = undefined;
      stop?.();
      lose();
      listeners.clear();
      const drop = marker;
      marker = undefined;
      drop?.release();
    };
    try {
      captured = prove();
      if (!isNoteMarkerSelectionCapture(captured))
        throw new Error('Invalid marker selection capture');
      unsubscribe = marker.subscribe(lose);
      // subscribe executes ownership checks; renew proof afterward.
      if (!current()) throw new Error('Stale marker selection capture');
      const capture = captured;
      if (!capture) throw new Error('Marker selection capture lost');
      return Object.freeze({
        capture,
        current,
        release,
        subscribe: (f: () => void) => {
          if (!current()) {
            f();
            return () => {};
          }
          listeners.add(f);
          return () => {
            listeners.delete(f);
          };
        },
      });
    } catch (error) {
      release();
      throw error;
    }
  }
  /** Read-only correspondence for one mounted atom. This is not canonical marker
   * provenance or edit authority. Caller admits capture/proof DATA before entry;
   * the existing window lease remains held until explicit physical settlement. */
  borrowMarkerOccurrence(
    identity: NoteMarkerCaptureInput['identity'],
    position: number,
    operationCurrent: () => boolean,
  ) {
    const editor = this.editor,
      window = this.window,
      projection = this.committedProjection,
      lease = this.currentLease;
    let contextCurrent = window ? markerContextWitness(window.context) : undefined;
    const boundaries = window?.context.filter((item) => item.kind === 'boundary');
    const boundary = boundaries?.[0];

    if (
      !editor ||
      !window ||
      window.text.length > noteMarkerCaptureLimits.windowUnits ||
      !projection ||
      !lease ||
      !this.options.retainWindow ||
      this.historyOwner ||
      this.mountedEditing ||
      this.options.editing ||
      projection instanceof NoteEditAuthority ||
      window.native ||
      window.canonicalOwners?.length ||
      boundaries?.length !== 1 ||
      window.context.length > NOTE_WINDOW_LIMITS.descriptors ||
      window.context.some(
        (item) =>
          item !== boundary &&
          (item.kind !== 'span' ||
            !['text', 'commentMarker'].includes(item.role) ||
            item.nativeRef ||
            item.sourceMapRef ||
            item.codeSource ||
            item.sourceRange.start < window.range.start ||
            item.sourceRange.end > window.range.end),
      ) ||
      boundary?.kind !== 'boundary' ||
      boundary.construct !== 'paragraph' ||
      boundary.entryPath !== 'markdown' ||
      boundary.parentRef ||
      boundary.nativeRef ||
      boundary.sourceMapRef ||
      boundary.attributesRef ||
      boundary.profile ||
      boundary.htmlPosition ||
      boundary.htmlSource ||
      boundary.tablePosition ||
      boundary.sourceRange.start !== window.range.start ||
      boundary.sourceRange.end !== window.range.end ||
      boundary.continuationBefore ||
      boundary.continuationAfter ||
      editor.state.doc.childCount !== 1 ||
      projection.source !== window.text ||
      projection.start !== window.range.start ||
      !Number.isSafeInteger(position) ||
      position < 1 ||
      !Number.isSafeInteger(identity.documentGeneration) ||
      identity.documentGeneration !== 0
    )
      throw new UnsupportedNoteMarkerCapture('Unsupported read-only native marker borrow');
    const original = Object.freeze({ ...identity, scope: Object.freeze({ ...identity.scope }) });
    let snapshot:
      | {
          editor: Editor;
          window: NoteWindow;
          projection: SourceProjection;
          lease: WindowLease;
          state: EditorState;
          epoch: number;
          text: string;
          start: number;
          end: number;
          length: number;
          context: NoteWindow['context'];
          boundary: Extract<NoteWindow['context'][number], { kind: 'boundary' }>;
          boundaryId: string;
          entryPath: typeof boundary.entryPath;
          expiry: string | undefined;
        }
      | undefined = {
      editor,
      window,
      projection,
      lease,
      state: editor.state,
      epoch: this.selectionCaptureGeneration,
      text: window.text,
      start: window.range.start,
      end: window.range.end,
      length: window.sourceLength,
      context: window.context,
      boundary,
      boundaryId: boundary.id,
      entryPath: boundary.entryPath,
      expiry: window.expiresAt,
    };
    let checkOperation: (() => boolean) | undefined = operationCurrent;
    let captured: NoteMarkerCapture | undefined;
    let retained: (() => void) | undefined;
    let lost = false,
      released = false;
    const listeners = new Set<() => void>();
    const notify = (f: () => void) => {
      try {
        f();
      } catch (error) {
        logger.error('Failed to notify native marker loss', error);
      }
    };
    const lose = () => {
      if (lost) return;
      lost = true;
      snapshot = undefined;
      contextCurrent = undefined;
      captured = undefined;
      checkOperation = undefined;
      for (const f of [...listeners]) notify(f);
    };
    const same = (s: NonNullable<typeof snapshot>, time: number) =>
      !this.disposed &&
      !this.selectionBorrowExhausted &&
      !s.editor.isDestroyed &&
      !this.historyBusy &&
      !this.transactionRelay?.busy &&
      !s.editor.view.composing &&
      !this.pins.has(this.compositionPin) &&
      !this.historyOwner &&
      !this.mountedEditing &&
      !this.options.editing &&
      this.editor === s.editor &&
      s.editor.state === s.state &&
      this.window === s.window &&
      this.committedProjection === s.projection &&
      this.projection === s.projection &&
      this.currentLease === s.lease &&
      this.selectionCaptureGeneration === s.epoch &&
      original.liveGeneration === s.epoch &&
      s.window.text === s.text &&
      s.window.range.start === s.start &&
      s.window.range.end === s.end &&
      s.window.sourceLength === s.length &&
      s.projection.source === s.text &&
      s.projection.start === s.start &&
      !s.window.native &&
      !s.window.canonicalOwners?.length &&
      Object.getOwnPropertyDescriptor(s.window, 'context')?.value === s.context &&
      contextCurrent?.() === true &&
      s.boundary.kind === 'boundary' &&
      s.boundary.id === s.boundaryId &&
      s.boundary.construct === 'paragraph' &&
      s.boundary.entryPath === s.entryPath &&
      !s.boundary.parentRef &&
      s.boundary.sourceRange.start === s.start &&
      s.boundary.sourceRange.end === s.end &&
      !s.boundary.continuationBefore &&
      !s.boundary.continuationAfter &&
      s.window.sourceRevision === original.sourceRevision &&
      s.window.snapshotId === original.snapshotId &&
      sameNoteScope(s.window.scope, original.scope) &&
      s.window.expiresAt === s.expiry &&
      Date.parse(s.expiry ?? '') >= Date.parse(original.expiresAt) &&
      Date.parse(original.expiresAt) > time &&
      identity.sourceRevision === original.sourceRevision &&
      identity.snapshotId === original.snapshotId &&
      identity.documentGeneration === original.documentGeneration &&
      identity.liveGeneration === original.liveGeneration &&
      identity.selectionGeneration === original.selectionGeneration &&
      identity.expiresAt === original.expiresAt &&
      sameNoteScope(identity.scope, original.scope);
    const current = () => {
      if (lost || released || !snapshot) return false;
      try {
        const s = snapshot;
        const time = Date.now();
        if (!same(s, time) || !checkOperation?.() || !same(s, Date.now())) lose();
        if (!lost && captured) {
          const proof = captureNoteMarker(s.editor.view, {
            projection: s.projection,
            identity: original,
            position,
            current: () => true,
          });
          if (JSON.stringify(proof) !== JSON.stringify(captured) || !same(s, time)) lose();
        }
      } catch {
        lose();
      }
      return !lost && !released;
    };
    if (!current()) throw new Error('Stale native marker borrow');
    const invalidated = () => lose();
    this.selectionBorrowListeners.add(invalidated);
    const release = () => {
      if (released) return;
      released = true;
      this.selectionBorrowListeners.delete(invalidated);
      lose();
      listeners.clear();
      const drop = retained;
      retained = undefined;
      drop?.();
    };
    try {
      retained = lease.retain();
      const s = snapshot;
      if (!s) throw new Error('Native marker borrow lost before capture');
      const capture = captureNoteMarker(s.editor.view, {
        projection: s.projection,
        identity: original,
        position,
        current,
      });
      if (!isNoteMarkerCapture(capture)) throw new Error('Invalid native marker capture');
      captured = capture;
      if (!current()) throw new Error('Native marker changed during capture');
      return Object.freeze({
        capture,
        current,
        retire: lose,
        release,
        subscribe: (f: () => void) => {
          if (!current()) {
            notify(f);
            return () => {};
          }
          listeners.add(f);
          return () => {
            listeners.delete(f);
          };
        },
      });
    } catch (error) {
      release();
      throw error;
    }
  }
  private borrowNativeCapture<T>(
    identity: NoteSelectionMarkdownIdentity,
    operationCurrent: () => boolean,
    captureNative: (editor: Editor, authority: NoteEditAuthority, current: () => boolean) => T,
    verifyCorrespondence = false,
  ) {
    const editor = this.editor,
      window = this.window,
      authority = this.committedProjection,
      owner = this.historyOwner,
      lease = this.currentLease,
      editing = this.mountedEditing;
    if (
      !editor ||
      !window ||
      !(authority instanceof NoteEditAuthority) ||
      !owner ||
      !lease ||
      !this.options.retainWindow
    )
      throw new Error('Missing current native selection authority');
    const capturedIdentity = Object.freeze({
      ...identity,
      scope: Object.freeze({ ...identity.scope }),
    });
    let snapshot:
      | {
          editor: Editor;
          window: NoteWindow;
          authority: NoteEditAuthority;
          owner: NoteTransactionOwner;
          lease: WindowLease;
          editing: NoteViewEditing | undefined;
          state: EditorState;
          epoch: number;
          windowExpiry: string | undefined;
        }
      | undefined = {
      editor,
      window,
      authority,
      owner,
      lease,
      editing,
      state: editor.state,
      epoch: this.selectionCaptureGeneration,
      windowExpiry: window.expiresAt,
    };
    let checkOperation: (() => boolean) | undefined = operationCurrent;
    let retained: (() => void) | undefined;
    let captured: T | undefined;
    let lost = false,
      released = false;
    const listeners = new Set<() => void>();
    const notify = (changed: () => void) => {
      try {
        changed();
      } catch (error) {
        logger.error('Failed to notify selection borrow loss', error);
      }
    };
    const lose = () => {
      if (lost) return;
      lost = true;
      // Drop native graph references immediately; the shared context lease stays
      // charged until the consumer settles its IO and explicitly releases.
      snapshot = undefined;
      captured = undefined;
      checkOperation = undefined;
      for (const changed of [...listeners]) notify(changed);
    };
    const same = (s: NonNullable<typeof snapshot>) =>
      !this.disposed &&
      !this.selectionBorrowExhausted &&
      !s.editor.isDestroyed &&
      !this.historyBusy &&
      !this.transactionRelay?.busy &&
      !s.editor.view.composing &&
      !this.pins.has(this.compositionPin) &&
      this.selectionCaptureGeneration === s.epoch &&
      capturedIdentity.liveGeneration === s.epoch &&
      this.editor === s.editor &&
      s.editor.state === s.state &&
      this.window === s.window &&
      this.committedProjection === s.authority &&
      this.projection === s.authority &&
      this.historyOwner === s.owner &&
      this.currentLease === s.lease &&
      this.historyLease === s.lease &&
      this.mountedEditing === s.editing &&
      this.options.editing === s.editing &&
      s.authority.doc === s.state.doc &&
      s.authority.generation === capturedIdentity.documentGeneration &&
      s.authority.sourceRevision === capturedIdentity.sourceRevision &&
      s.authority.snapshotId === capturedIdentity.snapshotId &&
      sameNoteScope(s.authority.scope, capturedIdentity.scope) &&
      s.window.expiresAt === s.windowExpiry &&
      s.window.sourceRevision === capturedIdentity.sourceRevision &&
      s.window.snapshotId === capturedIdentity.snapshotId &&
      sameNoteScope(s.window.scope, capturedIdentity.scope) &&
      Date.parse(s.windowExpiry ?? '') >= Date.parse(capturedIdentity.expiresAt) &&
      Date.parse(capturedIdentity.expiresAt) > Date.now() &&
      identity.sourceRevision === capturedIdentity.sourceRevision &&
      identity.snapshotId === capturedIdentity.snapshotId &&
      identity.documentGeneration === capturedIdentity.documentGeneration &&
      identity.liveGeneration === capturedIdentity.liveGeneration &&
      identity.selectionGeneration === capturedIdentity.selectionGeneration &&
      identity.expiresAt === capturedIdentity.expiresAt &&
      sameNoteScope(identity.scope, capturedIdentity.scope);
    const current = () => {
      if (lost || released || !snapshot) return false;
      try {
        const s = snapshot;
        if (!same(s) || !s.owner.current() || !checkOperation?.() || !s.owner.current() || !same(s))
          lose();
        if (!lost && verifyCorrespondence && captured !== undefined) {
          // Ownership callbacks above may mutate correspondence in place. Repeat
          // the bounded native proof after the last such callback; this final
          // capture uses no external owner callback and never publishes a new DTO.
          const verified = captureNative(s.editor, s.authority, () => true);
          if (JSON.stringify(verified) !== JSON.stringify(captured)) lose();
        }
      } catch {
        lose();
      }
      return !lost && !released;
    };
    if (!current()) throw new Error('Stale native selection borrow');
    const invalidated = () => lose();
    this.selectionBorrowListeners.add(invalidated);
    const release = () => {
      if (released) return;
      released = true;
      this.selectionBorrowListeners.delete(invalidated);
      snapshot = undefined;
      checkOperation = undefined;
      const releaseData = retained;
      retained = undefined;
      lose();
      listeners.clear();
      releaseData?.();
    };
    try {
      retained = lease.retain();
      const capture = captureNative(editor, authority, current);
      captured = capture;
      if (!current()) throw new Error('Native selection changed during borrow');
      const subscribe = (changed: () => void) => {
        if (!current()) {
          notify(changed);
          return () => {};
        }
        listeners.add(changed);
        return () => {
          listeners.delete(changed);
        };
      };
      return Object.freeze({ capture, current, release, subscribe });
    } catch (error) {
      release();
      throw error;
    }
  }
  private committedProjection?: SourceProjection;
  private committedCoordinates?: NoteViewCoordinates;
  private transactionRelay?: ReturnType<typeof createNoteTransactionRelay>;
  get projection() {
    if (this.transactionRelay?.busy && this.editor)
      return this.transactionRelay.projectionAt(this.editor.state) ?? this.committedProjection;
    return this.committedProjection;
  }
  private get coordinates(): NoteViewCoordinates | undefined {
    if (this.transactionRelay?.busy && this.editor) {
      const provisional = this.transactionRelay.coordinatesAt(this.editor.state);
      if (provisional) return provisional;
    }
    if (this.committedCoordinates) return this.committedCoordinates;
    const window = this.window;
    return (
      window && {
        start: window.range.start,
        end: window.range.end,
        length: window.sourceLength,
        toBase: (position: number) => position,
      }
    );
  }
  private seekCurrent(position: number, affinity: -1 | 1 = 1) {
    if (this.historyBusy) return;
    const coordinates = this.coordinates;
    if (coordinates)
      this.options.seek(
        coordinates.toBase(Math.max(0, Math.min(coordinates.length, position)), affinity),
      );
    else this.options.seek(Math.max(0, position));
  }
  window?: NoteWindow;
  private pending?: NoteWindow;
  private currentLease?: WindowLease;
  private mountedEditing?: NoteViewEditing;
  private historyOwner?: NoteTransactionOwner;
  private historyLease?: WindowLease;
  private historyEditing?: NoteViewEditing;
  private historyBusy = false;
  private historyCancelled = false;
  private pendingHistory?: 'undo' | 'redo';
  private lifetime?: NoteNativeLifetime;
  private bindEditing?: (editing: NoteViewEditing | undefined) => boolean;
  private pendingLease?: WindowLease;
  private pins = new Set<string | symbol>();
  private readonly compositionPin = Symbol('native composition');
  private disposed = false;
  private applying = false;
  private requested = -1;
  private rate = 0.35;
  private frame = 0;
  private domFrame = 0;
  private programmatic = false;
  private selection: NoteSourceSelection = {
    anchor: 0,
    head: 0,
    anchorAffinity: 1,
    headAffinity: 1,
  };
  private anchor?: { source: number; offset: number };
  private navigationAnchor?: { source: number; offset: number };
  readonly host = document.createElement('div');
  private readonly before = document.createElement('div');
  private readonly after = document.createElement('div');
  readonly cost = {
    createdViews: 0,
    destroyedViews: 0,
    mountedViews: 0,
    mountedNodes: 0,
    mountedDomNodes: 0,
    domPayloadBytes: 0,
    domPeakBytes: 0,
    domMeasurementNodes: 0,
    sourceBytes: 0,
    contextBytes: 0,
    pendingBytes: 0,
    derivedBytes: 0,
    projectionPeakBytes: 0,
    windowAssemblyPeakBytes: 0,
  };
  private observer: ResizeObserver;
  private domObserver: MutationObserver;
  constructor(
    readonly scroller: HTMLElement,
    private readonly options: NoteWindowViewOptions,
  ) {
    this.before.setAttribute('aria-hidden', 'true');
    this.after.setAttribute('aria-hidden', 'true');
    this.host.className = 'note-window-native';
    this.host.style.position = 'relative';
    scroller.append(this.before, this.host, this.after);
    scroller.style.overflowAnchor = 'none';
    scroller.addEventListener('scroll', this.scroll, { passive: true });
    scroller.addEventListener('wheel', this.physicalIntent, { passive: true });
    scroller.addEventListener('pointerdown', this.physicalIntent);
    scroller.addEventListener('keydown', this.keydown, true);
    scroller.addEventListener('copy', this.copy, true);
    this.host.addEventListener('compositionstart', this.compositionStart);
    this.host.addEventListener('compositionend', this.compositionEnd);
    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(this.host);
    this.domObserver = new MutationObserver(this.scheduleDomMeasurement);
    this.observeDom();
  }
  private observeDom(root: Node = this.host) {
    this.domObserver.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  }
  private scheduleDomMeasurement = () => {
    if (this.disposed || this.domFrame) return;
    this.domFrame = requestAnimationFrame(() => {
      this.domFrame = 0;
      this.measureDom();
    });
  };
  private measureDom() {
    if (this.disposed) return;
    const measured = measureNoteDom(this.host);
    this.cost.mountedDomNodes = measured.nodes;
    this.cost.domPayloadBytes = measured.payloadBytes;
    this.cost.domPeakBytes = Math.max(this.cost.domPeakBytes, measured.payloadBytes);
    this.cost.domMeasurementNodes += measured.nodes;
    // Releasing old roots prevents detached primitive output from staying owned.
    this.domObserver.disconnect();
    this.observeDom();
    for (const root of measured.shadowRoots) this.observeDom(root);
  }
  updateEditing(editing?: NoteViewEditing) {
    this.invalidateSelectionBorrows();
    if (this.historyBusy) {
      this.historyCancelled = true;
      this.options.editing = editing;
      return;
    }
    if (this.transactionRelay?.defer('owner', () => this.updateEditing(editing))) return;
    const changed = editing !== this.options.editing || editing !== this.mountedEditing;
    this.options.editing = editing;
    this.mountedEditing = editing;
    if (changed) {
      this.historyOwner = undefined;
      this.historyLease = undefined;
      this.historyEditing = undefined;
      // A borrowed factory is single-use and refers to the original base document.
      // The caller supplies the next prepared context to show(), which remounts it.
      const borrowed = this.currentLease?.borrowed || editing?.borrow;
      this.editor?.setEditable(borrowed ? false : (this.bindEditing?.(editing) ?? false), false);
    }
  }
  private publishSelection() {
    this.invalidateSelectionBorrows();
    if (this.historyBusy) return;
    const selection = this.getSelection();
    this.mountedEditing?.selectionChanged?.(selection);
    this.options.selectionChanged(selection);
  }
  getSelection(): NoteSourceSelection {
    return { ...this.selection };
  }
  private command(kind: 'copy' | 'search' | 'selectAll') {
    if (this.historyBusy) return;
    if (kind === 'selectAll' && this.coordinates) {
      this.selection = {
        anchor: 0,
        head: this.coordinates.length,
        anchorAffinity: 1,
        headAffinity: 1,
      };
      this.publishSelection();
      if (this.editor) {
        this.applying = true;
        try {
          this.editor.view.dispatch(
            this.editor.state.tr
              .setSelection(new AllSelection(this.editor.state.doc))
              .setMeta('addToHistory', false),
          );
        } finally {
          this.applying = false;
        }
      }
    }
    this.options.fullOperation(kind, this.getSelection());
  }
  private physicalIntent = () => {
    // A user scroll wins over a pending resize correction and over programmatic
    // scroll-event suppression. The next scroll event captures the new anchor.
    this.anchor = undefined;
    this.programmatic = false;
  };
  private keydown = (event: KeyboardEvent) => {
    if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp'].includes(event.key))
      this.physicalIntent();
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    if (key === 'a' || key === 'f') {
      event.preventDefault();
      event.stopPropagation();
      this.command(key === 'a' ? 'selectAll' : 'search');
    }
  };
  private copy = (event: Event) => {
    if (this.historyBusy || this.transactionRelay?.busy) {
      event.preventDefault();
      return;
    }
    const w = this.coordinates,
      s = this.selection;
    if (w && (s.anchor < w.start || s.anchor > w.end || s.head < w.start || s.head > w.end)) {
      event.preventDefault();
      event.stopPropagation();
      this.command('copy');
    }
  };
  forceMount(reason: 'focus' | 'selection' | 'composition') {
    const owner = Symbol(reason);
    this.pin(owner);
    return () => this.release(owner);
  }
  private compositionStart = () => {
    this.invalidateSelectionBorrows();
    this.pins.add(this.compositionPin);
  };
  private compositionEnd = () => {
    // ProseMirror's final composition transaction runs before the next animation frame.
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.release(this.compositionPin);
    });
  };
  pin(reason: string | symbol) {
    this.pins.add(reason);
  }
  release(reason: string | symbol) {
    if (!this.pins.delete(reason)) return;
    if (!this.pins.size && this.pending) {
      const pending = this.pending;
      this.show(pending);
    }
    if (!this.pins.size && this.pendingHistory) {
      const direction = this.pendingHistory;
      this.pendingHistory = undefined;
      this.history(direction);
    }
  }
  reveal(position: number) {
    this.navigationAnchor = { source: position, offset: this.scroller.clientHeight / 3 };
    if (
      this.coordinates &&
      position >= this.coordinates.start &&
      position <= this.coordinates.end
    ) {
      this.anchor = this.navigationAnchor;
      this.navigationAnchor = undefined;
      this.restoreAnchor();
    } else this.seekCurrent(Math.max(0, position - 1024));
  }
  setSelection(selection: NoteSourceSelection) {
    this.invalidateSelectionBorrows();
    if (this.historyBusy) return;
    if (this.transactionRelay?.defer('selection', () => this.setSelection(selection))) return;
    this.selection = { ...selection };
    this.publishSelection();
    const w = this.coordinates,
      p = this.projection,
      e = this.editor;
    if (!w || !p || !e || selection.head < w.start || selection.head > w.end) {
      this.navigationAnchor = { source: selection.head, offset: this.scroller.clientHeight / 3 };
      this.seekCurrent(Math.max(0, selection.head - 1024), selection.headAffinity);
      return;
    }
    this.applying = true;
    try {
      e.view.dispatch(
        e.state.tr
          .setSelection(
            TextSelection.create(
              e.state.doc,
              p.pmAt(
                Math.max(w.start, Math.min(w.end, selection.anchor)),
                selection.anchorAffinity,
              ),
              p.pmAt(selection.head, selection.headAffinity),
            ),
          )
          .setMeta('addToHistory', false),
      );
    } finally {
      this.applying = false;
    }
  }
  private captureAnchor() {
    const e = this.editor,
      p = this.projection;
    if (!e || !p) return undefined;
    const rect = this.scroller.getBoundingClientRect();
    const hit = e.view.posAtCoords({ left: rect.left + 24, top: rect.top + 4 });
    if (!hit) return undefined;
    try {
      return { source: p.sourceAt(hit.pos), offset: e.view.coordsAtPos(hit.pos).top - rect.top };
    } catch {
      return undefined;
    }
  }
  private releasePending() {
    const lease = this.pendingLease;
    this.pending = undefined;
    this.pendingLease = undefined;
    this.cost.pendingBytes = 0;
    lease?.release();
  }
  private retain(window: NoteWindow): WindowLease {
    const data = this.options.retainWindow?.(window);
    const editing = this.options.editing;
    try {
      const borrow = editing?.borrow?.(window);
      let released = false,
        references = 1;
      const drop = () => {
        if (--references !== 0) return;
        try {
          borrow?.release();
        } finally {
          data?.();
        }
      };
      return {
        editing,
        bind: borrow?.bind ?? editing?.bind.bind(editing),
        borrowed: !!borrow,
        retain() {
          if (released || references === Number.MAX_SAFE_INTEGER)
            throw new Error('Native window lease unavailable');
          references++;
          let done = false;
          return () => {
            if (done) return;
            done = true;
            drop();
          };
        },
        release() {
          if (released) return;
          released = true;
          drop();
        },
      };
    } catch (error) {
      data?.();
      throw error;
    }
  }
  /** Navigation changes the desired window, not the owner of a still-composing
   * mounted view. Its context independently checks revision, expiry and revocation. */
  showPrepared(window: NoteWindow, editing?: NoteViewEditing) {
    if (this.historyBusy) return false;
    if (
      this.window &&
      this.currentLease?.borrowed &&
      sameNoteScope(this.window.scope, window.scope) &&
      this.window.sourceRevision === window.sourceRevision
    )
      this.options.editing = editing;
    else this.updateEditing(editing);
    return this.show(window);
  }
  show(window: NoteWindow, history?: { lease: WindowLease }) {
    this.invalidateSelectionBorrows();
    if (this.historyBusy && !history) return false;
    if (this.disposed) return false;
    if (this.transactionRelay?.busy) {
      if (this.pending !== window || this.pendingLease?.editing !== this.options.editing) {
        this.releasePending();
        const lease = this.retain(window);
        this.pending = window;
        this.pendingLease = lease;
        this.cost.pendingBytes = window.cost.sourceBytes + window.cost.contextBytes;
      }
      this.transactionRelay.defer('window', () => {
        if (this.pending) this.show(this.pending);
      });
      return false;
    }
    if (this.window === window && this.currentLease?.editing === this.options.editing) {
      this.pending = undefined;
      this.pendingLease?.release();
      this.pendingLease = undefined;
      return true;
    }
    if (!history && (this.pins.size || this.editor?.view.composing)) {
      if (this.pending === window && this.pendingLease?.editing === this.options.editing)
        return false;
      this.releasePending();
      const lease = this.retain(window);
      this.pendingLease = lease;
      this.pending = window;
      this.cost.pendingBytes = window.cost.sourceBytes + window.cost.contextBytes;
      return false;
    }
    const retained =
      this.pending === window && this.pendingLease?.editing === this.options.editing
        ? this.pendingLease
        : undefined;
    if (!retained) this.releasePending();
    const lease = history?.lease ?? retained ?? this.retain(window);
    this.pending = undefined;
    this.pendingLease = undefined;
    const lifetime = new NoteNativeLifetime();
    let candidate: Editor | undefined;
    let candidateHost: HTMLDivElement | undefined;
    let published = false;
    try {
      const anchor = this.navigationAnchor ?? this.captureAnchor();
      // Build/admit first; unsupported context must leave the existing view intact.
      const projection = projectNoteWindow(window);
      let admitted = measureNoteProjection(projection);
      this.cost.projectionPeakBytes = Math.max(
        this.cost.projectionPeakBytes,
        this.cost.derivedBytes + admitted.derivedBytes,
      );
      this.cost.windowAssemblyPeakBytes = Math.max(
        this.cost.windowAssemblyPeakBytes,
        window.cost.assemblyPeakBytes,
      );
      const config = createEditorConfig({
        element: this.host,
        content: '',
        workspace: this.options.workspace,
        editable: !!this.options.editing,
        useMarkdown: true,
        enableComments: false,
        enableMentions: true,
        enableNotePrimitives: true,
        onUpdate: () => {},
      });
      const extensions = (config.extensions ?? []).map((e) =>
        e.name === 'starterKit' ? e.configure({ undoRedo: false }) : e,
      );
      let boundEditing = lease.editing;
      let editOwner: NoteTransactionOwner | undefined;
      let currentProjection = projection;
      let currentCoordinates: NoteViewCoordinates | undefined;
      const transactions = createNoteTransactionRelay(() =>
        !this.historyBusy && this.editor === candidate && this.mountedEditing === boundEditing
          ? editOwner
          : undefined,
      );
      const retireFailedView = () => {
        if (this.editor !== candidate) return;
        this.destroyEditor();
        this.pending = undefined;
        this.pendingLease?.release();
        this.pendingLease = undefined;
        this.cost.pendingBytes = 0;
        this.options.failed?.();
      };
      const relay = Extension.create({
        name: 'noteDocumentCommands',
        priority: 2000,
        addProseMirrorPlugins: () => [transactions.plugin],
        dispatchTransaction({ transaction, next }) {
          try {
            transactions.dispatch(transaction, next, this.editor);
          } catch (error) {
            try {
              retireFailedView();
            } catch (cleanup) {
              throw new AggregateError([error, cleanup], 'Native note view retirement failed', {
                cause: error,
              });
            }
            throw error;
          }
        },
        addKeyboardShortcuts: () => ({
          'Mod-z': () => {
            this.history('undo');
            return true;
          },
          'Mod-Shift-z': () => {
            this.history('redo');
            return true;
          },
          'Mod-a': () => {
            this.command('selectAll');
            return true;
          },
          'Mod-f': () => {
            this.command('search');
            return true;
          },
        }),
      });
      candidateHost = document.createElement('div');
      candidateHost.style.cssText =
        'position:absolute;visibility:hidden;inset:0 auto auto 0;width:100%';
      this.host.append(candidateHost);
      candidate = new Editor({
        ...config,
        element: null,
        content: projection.content,
        extensions: lifetime.extensions([...extensions, CommentAnchor, relay]),
        editorProps: {
          ...config.editorProps,
          handleDOMEvents: {
            ...config.editorProps?.handleDOMEvents,
            copy: (_view, event) => {
              if (this.historyBusy || transactions.busy) {
                event.preventDefault();
                return true;
              }
              const coordinates = this.coordinates;
              if (
                coordinates &&
                (this.selection.anchor < coordinates.start ||
                  this.selection.anchor > coordinates.end ||
                  this.selection.head < coordinates.start ||
                  this.selection.head > coordinates.end)
              ) {
                event.preventDefault();
                this.command('copy');
                return true;
              }
              return false;
            },
          },
          handleKeyDown: (_view, event) => {
            if (
              event.key === 'ArrowDown' ||
              event.key === 'ArrowRight' ||
              event.key === 'ArrowUp' ||
              event.key === 'ArrowLeft'
            ) {
              const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
              const coordinates = this.coordinates;
              if (!coordinates) return false;
              const edge = direction > 0 ? coordinates.end : coordinates.start;
              if (
                Math.abs(this.selection.head - edge) < 2 &&
                edge > 0 &&
                edge < coordinates.length
              ) {
                const head = Math.min(
                  coordinates.length,
                  Math.max(0, this.selection.head + direction),
                );
                this.selection = {
                  ...this.selection,
                  anchor: event.shiftKey ? this.selection.anchor : head,
                  head,
                };
                this.publishSelection();
                this.seekCurrent(head, direction);
                event.preventDefault();
                return true;
              }
            }
            return false;
          },
        },
        onTransaction: ({ transaction, appendedTransactions }) => {
          if (
            this.editor === candidate &&
            [transaction, ...appendedTransactions].some(
              (step) => step.docChanged || step.selectionSet,
            )
          )
            this.invalidateSelectionBorrows();
          if (!candidate || this.historyBusy || this.applying || this.editor !== candidate) return;
          const chain = [transaction, ...appendedTransactions];
          if (chain.some((step) => step.docChanged)) {
            const accepted = transactions.adopt(chain, this.editor.state);
            if (!accepted) {
              // A replaced owner may not adopt a stale native result.
              editOwner = undefined;
              this.editor.setEditable(false, false);
              return;
            }
            currentProjection = accepted.projection;
            this.committedProjection = accepted.projection;
            currentCoordinates = accepted.coordinates;
            this.committedCoordinates = accepted.coordinates;
            this.layout();
            this.cost.projectionPeakBytes = Math.max(
              this.cost.projectionPeakBytes,
              this.cost.derivedBytes + accepted.cost.derivedBytes,
            );
            this.cost.derivedBytes = accepted.cost.derivedBytes;
            let nodes = 0;
            this.editor.state.doc.descendants(() => {
              nodes++;
            });
            this.cost.mountedNodes = nodes;
          }
          if (chain.some((step) => step.selectionSet || step.docChanged) && this.projection) {
            try {
              const selection = this.editor.state.selection;
              const anchor = this.projection.sourceAt(selection.anchor),
                head = this.projection.sourceAt(selection.head);
              this.selection = { anchor, head, anchorAffinity: 1, headAffinity: 1 };
              this.publishSelection();
            } catch {
              /* Structural atoms report their bounded source range through navigation. */
            }
          }
        },
      });
      editOwner = lease.bind?.(window, projection, candidate.state.doc);
      if (editOwner) {
        const initial = editOwner.initial;
        if (
          !editOwner.current() ||
          initial.doc.type.schema !== candidate.schema ||
          !initial.doc.eq(
            validateNoteNativeOutput(candidate.schema, initial.projection.content, {
              current: () => editOwner?.current() ?? false,
            }),
          )
        )
          // i18n-ignore (internal validation; the view displays a localized error)
          throw new Error('Invalid initial note edit authority');
        admitted = measureNoteProjection(initial.projection);
        this.cost.projectionPeakBytes = Math.max(
          this.cost.projectionPeakBytes,
          this.cost.derivedBytes + admitted.derivedBytes,
        );
        // The editor is still unmounted. Install the materialized dirty document
        // and its exact map together, without a synthetic edit or history entry.
        candidate.view.updateState(
          EditorState.create({ schema: candidate.schema, doc: initial.doc }),
        );
        currentProjection = initial.projection;
        currentCoordinates = initial.coordinates;
      }
      candidate.setEditable(!!editOwner, false);
      candidate.mount(candidateHost);
      this.destroyEditor();
      this.host.replaceChildren(candidateHost);
      candidateHost.removeAttribute('style');
      this.committedProjection = currentProjection;
      this.committedCoordinates = currentCoordinates;
      this.window = window;
      this.editor = candidate;
      this.transactionRelay = transactions;
      this.bindEditing = (editing) => {
        boundEditing = editing;
        editOwner = editing?.bind(window, currentProjection, editor.state.doc);
        if (editOwner && (!editOwner.current() || !editOwner.initial.doc.eq(editor.state.doc)))
          editOwner = undefined;
        this.historyOwner = editOwner;
        this.historyLease = editOwner ? this.currentLease : undefined;
        this.historyEditing = editOwner ? editing : undefined;
        if (editOwner) {
          currentCoordinates = editOwner.initial.coordinates;
          this.committedCoordinates = currentCoordinates;
        }
        return !!editOwner;
      };
      this.historyOwner = editOwner;
      this.historyLease = editOwner ? lease : undefined;
      this.historyEditing = editOwner ? lease.editing : undefined;
      this.currentLease = lease;
      this.mountedEditing = lease.editing;
      this.lifetime = lifetime;
      this.cost.pendingBytes = 0;
      published = true;
      const editor = candidate;
      // Observe the actual native state boundary as well as TipTap transactions:
      // direct updateState/rollback must not restore a previously borrowed epoch.
      const nativeView = editor.view,
        updateState = nativeView.updateState;
      const observeState = (state: EditorState) => {
        if (nativeView.state !== state) this.invalidateSelectionBorrows();
        updateState.call(nativeView, state);
      };
      const nativeDestroyed = () => this.invalidateSelectionBorrows();
      nativeView.updateState = observeState;
      editor.on('destroy', nativeDestroyed);
      this.restoreSelectionObserver = () => {
        if (nativeView.updateState === observeState) nativeView.updateState = updateState;
        editor.off('destroy', nativeDestroyed);
      };
      this.cost.createdViews++;
      this.cost.mountedViews = 1;
      let nodes = 0;
      editor.state.doc.descendants(() => {
        nodes++;
      });
      this.cost.mountedNodes = nodes;
      this.cost.sourceBytes = window.cost.sourceBytes;
      this.cost.contextBytes = window.cost.contextBytes;
      this.cost.derivedBytes = admitted.derivedBytes;
      this.measureDom();
      this.requested = -1;
      this.layout();
      const coordinates = this.coordinates;
      if (
        coordinates &&
        anchor &&
        anchor.source >= coordinates.start &&
        anchor.source <= coordinates.end
      ) {
        this.anchor = anchor;
        this.navigationAnchor = undefined;
        this.restoreAnchor();
      }
      if (
        coordinates &&
        this.selection.head >= coordinates.start &&
        this.selection.head <= coordinates.end
      ) {
        this.setSelection(this.selection);
      }
      this.options.changed?.();
      return true;
    } catch (error) {
      if (!published) {
        void lifetime
          .dispose(
            () => candidate?.destroy(),
            () => lease?.release(),
          )
          .catch((cleanupError) =>
            logger.error('Failed to dispose candidate note view', cleanupError),
          );
        candidateHost?.remove();
      }
      throw error;
    }
  }
  /** A bounded document command, never the disposable editor's local history. */
  history(direction: 'undo' | 'redo') {
    this.invalidateSelectionBorrows();
    if (this.disposed || this.historyBusy) return false;
    if (this.transactionRelay?.defer('history', () => this.history(direction))) return false;
    if (this.pins.size || this.editor?.view.composing) {
      // At most one command waits for the current composition; further commands
      // are refused until it settles, rather than retaining an unbounded queue.
      this.pendingHistory ??= direction;
      return false;
    }
    const owner = this.historyOwner,
      editor = this.editor,
      window = this.window,
      editing = this.mountedEditing;
    if (!owner?.history) {
      this.mountedEditing?.[direction]();
      return false;
    }
    if (
      !editor ||
      !window ||
      this.historyLease !== this.currentLease ||
      this.historyEditing !== editing ||
      this.options.editing !== editing ||
      !owner.current()
    )
      return false;
    let plan: ReturnType<NonNullable<NoteTransactionOwner['history']>>;
    let lease: WindowLease | undefined;
    try {
      plan = owner.history(direction);
      if (!plan || !plan.current()) return false;
      const initial = plan.initial;
      if (
        initial.doc.type.schema !== editor.schema ||
        !initial.doc.eq(
          validateNoteNativeOutput(editor.schema, initial.projection.content, {
            current: () => plan?.current() ?? false,
          }),
        )
      )
        return false;
      measureNoteProjection(initial.projection);
      lease = this.retain(window);
      if (
        this.editor !== editor ||
        this.window !== window ||
        this.historyOwner !== owner ||
        this.mountedEditing !== editing ||
        !plan.current()
      ) {
        lease.release();
        return false;
      }
    } catch {
      lease?.release();
      return false;
    }
    this.historyBusy = true;
    this.historyCancelled = false;
    let mounted = false,
      transferred = false;
    try {
      // Admission is complete. Hide/retire old native text before publication;
      // callbacks cannot publish selection, navigation, copy or edits in this gap.
      this.destroyEditor();
      this.host.replaceChildren();
      this.window = undefined;
      if (this.historyCancelled || !plan.current()) return false;
      plan.commit();
      if (this.historyCancelled || !plan.adopted()) return false;
      this.selection = { ...plan.selection };
      transferred = true;
      mounted = this.show(window, { lease });
      return mounted;
    } catch (error) {
      this.options.failed?.();
      logger.error('Failed to adopt note history', error);
      return false;
    } finally {
      this.historyBusy = false;
      if (!transferred) lease.release();
      if (this.historyCancelled) this.destroy();
      else if (mounted) this.setSelection(plan.selection);
    }
  }
  private layout() {
    const w = this.coordinates;
    if (!w) return;
    // A compressed document extent stays within browser layout coordinate limits.
    const rate = Math.min(this.rate, 8_000_000 / Math.max(1, w.length));
    this.before.style.height = `${w.start * rate}px`;
    this.after.style.height = `${(w.length - w.end) * rate}px`;
  }
  private restoreAnchor() {
    if (!this.anchor || !this.editor || !this.projection) return;
    const at = this.projection.pmAt(this.anchor.source);
    const delta =
      this.editor.view.coordsAtPos(at).top -
      this.scroller.getBoundingClientRect().top -
      this.anchor.offset;
    if (Math.abs(delta) > 0.5) {
      this.programmatic = true;
      this.scroller.scrollTop += delta;
    }
  }
  private measure() {
    const coordinates = this.coordinates;
    if (!coordinates || this.disposed) return;
    this.scheduleDomMeasurement();
    const anchor = this.anchor ?? this.captureAnchor();
    const height = this.host.getBoundingClientRect().height;
    if (height > 0) {
      this.rate = height / Math.max(1, coordinates.end - coordinates.start);
      this.layout();
    }
    this.anchor = anchor;
    this.restoreAnchor();
  }
  private scroll = () => {
    if (this.programmatic) {
      this.programmatic = false;
      return;
    }
    const w = this.coordinates;
    if (!w) return;
    const viewport = this.scroller.getBoundingClientRect(),
      rect = this.host.getBoundingClientRect();
    this.anchor = this.captureAnchor();
    let target: number | undefined;
    if (rect.bottom < viewport.top || rect.top > viewport.bottom) {
      const rate = Math.min(this.rate, 8_000_000 / Math.max(1, w.length));
      target = Math.floor(this.scroller.scrollTop / rate);
    } else if (rect.bottom < viewport.bottom + 120 && w.end < w.length) {
      target = Math.max(w.start, w.end - 1024);
    } else if (rect.top > viewport.top - 120 && w.start > 0) {
      target = Math.max(0, w.start - 3072);
    }
    if (target !== undefined) {
      target = Math.max(0, Math.min(w.length - 1, target));
      if (target !== this.requested) {
        this.requested = target;
        this.seekCurrent(target, target < w.start ? -1 : 1);
      }
    }
  };
  private destroyEditor() {
    this.invalidateSelectionBorrows();
    this.restoreSelectionObserver?.();
    this.restoreSelectionObserver = undefined;
    const editor = this.editor,
      lifetime = this.lifetime,
      lease = this.currentLease;
    this.editor = undefined;
    this.bindEditing = undefined;
    this.lifetime = undefined;
    this.currentLease = undefined;
    this.mountedEditing = undefined;
    this.historyOwner = undefined;
    this.historyLease = undefined;
    this.historyEditing = undefined;
    this.committedProjection = undefined;
    this.committedCoordinates = undefined;
    this.transactionRelay = undefined;
    this.window = undefined;
    if (lifetime) {
      void lifetime
        .dispose(
          () => editor?.destroy(),
          () => lease?.release(),
        )
        .catch((error) => logger.error('Failed to dispose native note view', error));
    } else {
      editor?.destroy();
      lease?.release();
    }
    if (editor) {
      this.cost.destroyedViews++;
      this.cost.mountedViews = 0;
    }
  }
  destroy() {
    this.invalidateSelectionBorrows();
    if (this.historyBusy) {
      this.historyCancelled = true;
      return;
    }
    if (this.transactionRelay?.defer('destroy', () => this.destroy())) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    cancelAnimationFrame(this.domFrame);
    this.domObserver.disconnect();
    this.scroller.removeEventListener('scroll', this.scroll);
    this.scroller.removeEventListener('wheel', this.physicalIntent);
    this.scroller.removeEventListener('pointerdown', this.physicalIntent);
    this.scroller.removeEventListener('keydown', this.keydown, true);
    this.scroller.removeEventListener('copy', this.copy, true);
    this.host.removeEventListener('compositionstart', this.compositionStart);
    this.host.removeEventListener('compositionend', this.compositionEnd);
    this.destroyEditor();
    this.committedProjection = undefined;
    this.committedCoordinates = undefined;
    this.window = undefined;
    this.pending = undefined;
    this.pendingLease?.release();
    this.pendingLease = undefined;
    this.pins.clear();
    this.pendingHistory = undefined;
    this.before.remove();
    this.host.remove();
    this.after.remove();
    this.cost.mountedNodes = 0;
    this.cost.mountedDomNodes = 0;
    this.cost.domPayloadBytes = 0;
    this.cost.sourceBytes = 0;
    this.cost.contextBytes = 0;
    this.cost.pendingBytes = 0;
    this.cost.derivedBytes = 0;
  }
}
