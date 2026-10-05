/**
 * Binds a rich note editor to its note-presence session: publishes the local
 * selection as a caret in daemon-text coordinates and renders peers' carets
 * as remote cursor decorations.
 *
 * Coordinates: a wire caret is a UTF-16 offset into the daemon markdown at
 * `rev`. The editor's plain-text projection (`docTextOffsets`) shares its
 * characters with that markdown, so one `createBidirectionalOffsetMapper`
 * over the two texts aligns them in both directions; the editor's baseline
 * (`getBaseText` / `getBaseRev`, the text the editor was loaded from or last
 * saved) is the base both peers are assumed to be near.
 *
 * The alignment anchors the blocks the two texts share and diffs only the
 * text between them under a time budget — still tens of milliseconds on a
 * large note — so it is cached per (editor text, base text) and shared by
 * every consumer: selection publishes, the presence heartbeat, and peer-caret
 * renders reuse it until the document text or the base text actually changes.
 */
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { createBidirectionalOffsetMapper } from '$lib/notes/text-rebase';
import { docTextOffsets, type DocTextOffsets } from '$lib/notes/doc-text-offsets';
import {
  createRemoteCursorDecorationsPlugin,
  remoteCursorColor,
  remoteCursorsPluginKey,
  setRemoteCursors,
  type RemoteCursor,
} from '$lib/components/tiptap/RemoteCursorDecorations';
import type {
  NotePresenceSession,
  RemoteNoteViewer,
} from '$features/notes/note-presence/note-presence-service';
import type { NoteViewerCursor } from '$features/notes/note-presence/note-presence.client';

export interface RemoteCursorsBindingOptions {
  editor: Editor;
  session: NotePresenceSession;
  /** Daemon markdown the editor text derives from, and its rev. */
  getBaseText: () => string;
  getBaseRev: () => number | undefined;
}

function viewerLabel(viewer: RemoteNoteViewer): string {
  return viewer.displayName ?? viewer.login ?? viewer.principalId;
}

/** The editor text ↔ base text alignment for one (document, base text) pair. */
interface Alignment {
  doc: ProseMirrorNode;
  baseText: string;
  offsets: DocTextOffsets;
  localToBase: (offset: number) => number;
  baseToLocal: (offset: number) => number;
}

/**
 * Single-entry alignment cache. The plain-text projection is rebuilt only for
 * a new document object; the diff only when the projected text or the base
 * text differs from the cached pair — a selection-only transaction keeps the
 * same document, and a formatting-only one keeps the same text.
 */
function alignmentFor(
  cached: Alignment | undefined,
  doc: ProseMirrorNode,
  baseText: string,
): Alignment {
  if (cached && cached.doc === doc && cached.baseText === baseText) return cached;
  const offsets = cached?.doc === doc ? cached.offsets : docTextOffsets(doc);
  if (cached && cached.offsets.text === offsets.text && cached.baseText === baseText) {
    return { ...cached, doc, offsets };
  }
  const { aToB, bToA } = createBidirectionalOffsetMapper(offsets.text, baseText);
  return { doc, baseText, offsets, localToBase: aToB, baseToLocal: bToA };
}

/** Project peers' wire carets onto the editor document. */
function projectRemoteCursors(
  { offsets, baseToLocal }: Alignment,
  viewers: RemoteNoteViewer[],
): RemoteCursor[] {
  return viewers.flatMap((viewer) => {
    const cursor = viewer.cursor;
    if (!cursor) return [];
    return [
      {
        principalId: viewer.principalId,
        label: viewerLabel(viewer),
        avatarUrl: viewer.avatarUrl,
        color: remoteCursorColor(viewer.principalId),
        anchor: offsets.posOfOffset(baseToLocal(cursor.anchor)),
        head: offsets.posOfOffset(baseToLocal(cursor.head)),
      },
    ];
  });
}

/** Register the decorations plugin and wire both directions; returns a disposer. */
export function bindRemoteCursors(options: RemoteCursorsBindingOptions): () => void {
  const { editor, session, getBaseText, getBaseRev } = options;
  let disposed = false;
  let viewers: RemoteNoteViewer[] = session.getViewers();
  let renderFrame: number | undefined;
  let publishFrame: number | undefined;
  let alignment: Alignment | undefined;

  editor.registerPlugin(createRemoteCursorDecorationsPlugin());

  const align = (): Alignment => {
    alignment = alignmentFor(alignment, editor.state.doc, getBaseText());
    return alignment;
  };

  const render = () => {
    renderFrame = undefined;
    if (disposed || editor.isDestroyed) return;
    const cursors = viewers.some((viewer) => viewer.cursor)
      ? projectRemoteCursors(align(), viewers)
      : [];
    setRemoteCursors(editor.view, cursors);
  };
  const scheduleRender = () => {
    if (renderFrame !== undefined) return;
    renderFrame = requestAnimationFrame(render);
  };

  /** The local selection in daemon-text coordinates at the current base. */
  const currentCursor = (): NoteViewerCursor | undefined => {
    if (disposed || editor.isDestroyed) return undefined;
    const rev = getBaseRev();
    if (rev === undefined) return undefined;
    const { offsets, localToBase } = align();
    const { anchor, head } = editor.state.selection;
    return {
      rev,
      anchor: localToBase(offsets.offsetOfPos(anchor)),
      head: localToBase(offsets.offsetOfPos(head)),
    };
  };

  let hasPublished = false;
  const publishSelection = () => {
    publishFrame = undefined;
    const cursor = currentCursor();
    if (!cursor) return;
    hasPublished = true;
    session.publishCursor(cursor);
  };
  // The heartbeat re-samples the caret against the base current at that
  // moment, so an acknowledged save under an idle caret corrects the
  // published rev/offsets. A never-published editor stays caret-less.
  const offProvider = session.provideCursor(() => (hasPublished ? currentCursor() : undefined));
  // A publish runs once per frame at most, however many transactions a burst
  // of typing dispatches, and only re-aligns when the text actually changed;
  // the session throttles the wire further.
  const schedulePublish = () => {
    if (publishFrame !== undefined) return;
    publishFrame = requestAnimationFrame(publishSelection);
  };

  const offViewers = session.subscribe((next) => {
    viewers = next;
    scheduleRender();
  });
  // A local edit both moves our caret and may shift where peers' carets
  // project; the plugin maps existing decorations through the edit, and the
  // republish carries our new position.
  editor.on('selectionUpdate', schedulePublish);
  editor.on('update', schedulePublish);

  if (editor.isFocused) schedulePublish();
  scheduleRender();

  return () => {
    if (disposed) return;
    disposed = true;
    if (renderFrame !== undefined) cancelAnimationFrame(renderFrame);
    if (publishFrame !== undefined) cancelAnimationFrame(publishFrame);
    offProvider();
    offViewers();
    editor.off('selectionUpdate', schedulePublish);
    editor.off('update', schedulePublish);
    alignment = undefined;
    if (!editor.isDestroyed) {
      setRemoteCursors(editor.view, []);
      editor.unregisterPlugin(remoteCursorsPluginKey);
    }
  };
}
