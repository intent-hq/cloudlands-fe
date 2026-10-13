import { logger } from '$lib/utils/client-logger';
import type { NoteReadingSurface, NoteViewEditing } from './note-window-view';
import type { NoteWindow } from './note-window-reader';

/** Runtime preparation stays outside the component. Reads and retained DATA are
 * owned by the supplied Redux-backed service; this controller only fences delivery. */
export function prepareNoteWindowDisplay(
  window: NoteWindow,
  prepare: NonNullable<NoteReadingSurface['prepareEditing']>,
  show: (editing: NoteViewEditing | undefined) => void,
  failed: () => void,
) {
  let offer: ReturnType<typeof prepare>;
  try {
    offer = prepare(window);
  } catch {
    failed();
    return () => {};
  }
  let current = true,
    delivered = false;
  void offer.ready.then(
    (editing) => {
      if (current) {
        show(editing);
        delivered = true;
      }
    },
    () => {
      if (current) failed();
    },
  );
  return () => {
    current = false;
    if (!delivered || !offer.retire) offer.cancel();
    void (delivered && offer.retire ? offer.retire() : offer.release()).catch((error) =>
      logger.error('Failed to release note edit context', error),
    );
  };
}
