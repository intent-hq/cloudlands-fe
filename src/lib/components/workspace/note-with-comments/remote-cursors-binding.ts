/**
 * Binds a rich note editor to its note-presence session: publishes the local
 * selection as a caret in daemon-text coordinates and renders peers' carets
 * as remote cursor decorations.
 *
 * Coordinates: a wire caret is a UTF-16 offset into the daemon markdown at
 * `rev`. The editor's plain-text projection (`docTextOffsets`) shares its
 * characters with that markdown, so `createOffsetMapper` over the two texts
 * aligns them in both directions; the editor's baseline (`getBaseText` /
 * `getBaseRev`, the text the editor was loaded from or last saved) is the
 * base both peers are assumed to be near.
 */
import type { Editor } from '@tiptap/core';
import { createOffsetMapper } from '$lib/notes/text-rebase';
import { docTextOffsets } from '$lib/notes/doc-text-offsets';
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

/** Project peers' wire carets onto the editor document. */
function projectRemoteCursors(
  editor: Editor,
  baseText: string,
  viewers: RemoteNoteViewer[],
): RemoteCursor[] {
  const withCursor = viewers.flatMap((viewer) =>
    viewer.cursor ? [{ viewer, cursor: viewer.cursor }] : [],
  );
  if (withCursor.length === 0) return [];
  const offsets = docTextOffsets(editor.state.doc);
  const mapBaseToLocal = createOffsetMapper(baseText, offsets.text);
  return withCursor.map(({ viewer, cursor }) => {
    return {
      principalId: viewer.principalId,
      label: viewerLabel(viewer),
      avatarUrl: viewer.avatarUrl,
      color: remoteCursorColor(viewer.principalId),
      anchor: offsets.posOfOffset(mapBaseToLocal(cursor.anchor)),
      head: offsets.posOfOffset(mapBaseToLocal(cursor.head)),
    };
  });
}

/** Register the decorations plugin and wire both directions; returns a disposer. */
export function bindRemoteCursors(options: RemoteCursorsBindingOptions): () => void {
  const { editor, session, getBaseText, getBaseRev } = options;
  let disposed = false;
  let viewers: RemoteNoteViewer[] = session.getViewers();
  let renderFrame: number | undefined;
  let publishFrame: number | undefined;

  editor.registerPlugin(createRemoteCursorDecorationsPlugin());

  const render = () => {
    renderFrame = undefined;
    if (disposed || editor.isDestroyed) return;
    setRemoteCursors(editor.view, projectRemoteCursors(editor, getBaseText(), viewers));
  };
  const scheduleRender = () => {
    if (renderFrame !== undefined) return;
    renderFrame = requestAnimationFrame(render);
  };

  const publishSelection = () => {
    publishFrame = undefined;
    if (disposed || editor.isDestroyed) return;
    const rev = getBaseRev();
    if (rev === undefined) return;
    const offsets = docTextOffsets(editor.state.doc);
    const mapLocalToBase = createOffsetMapper(offsets.text, getBaseText());
    const { anchor, head } = editor.state.selection;
    session.publishCursor({
      rev,
      anchor: mapLocalToBase(offsets.offsetOfPos(anchor)),
      head: mapLocalToBase(offsets.offsetOfPos(head)),
    });
  };
  // The text diff runs once per frame at most, however many transactions a
  // burst of typing dispatches; the session throttles the wire further.
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
    offViewers();
    editor.off('selectionUpdate', schedulePublish);
    editor.off('update', schedulePublish);
    if (!editor.isDestroyed) {
      setRemoteCursors(editor.view, []);
      editor.unregisterPlugin(remoteCursorsPluginKey);
    }
  };
}
