/**
 * Counter-based drag/drop state tracking for an OS-file drop target.
 *
 * Wraps the dragenter/dragleave/dragover/drop choreography a drop zone needs:
 * enter/leave events fire per descendant element, so a counter tracks whether
 * the drag is still inside the target. All handlers are gated on
 * `isFileDragEvent` — text/content drags and tab drags pass through untouched.
 *
 * Used by ChatPanel to make the whole conversation panel a drop target that
 * forwards files into SimpleRichInput's attach pipeline, and by the
 * panel-system Panel for the header seam of that target.
 */
import { isFileDragEvent } from './drop-guard';

export interface FileDropTargetOptions {
  /** Called when the file-drag-over-target state flips. */
  onDragChange: (dragging: boolean) => void;
  /** Called with the dropped files (never empty). */
  onDrop: (files: File[]) => void;
  /**
   * When provided and returning false, all drag/drop events are ignored —
   * the target is inactive because a drop would have no consumer (e.g. the
   * chat input is unmounted while the question wizard is expanded).
   */
  isEnabled?: () => boolean;
}

export interface FileDropTarget {
  handleDragEnter(event: DragEvent): void;
  handleDragLeave(event: DragEvent): void;
  handleDragOver(event: DragEvent): void;
  handleDrop(event: DragEvent): void;
  /** Clear the drag state (e.g. when the target unmounts mid-drag). */
  reset(): void;
}

export function createFileDropTarget(options: FileDropTargetOptions): FileDropTarget {
  let counter = 0;
  let dragging = false;

  function setDragging(next: boolean) {
    if (dragging === next) return;
    dragging = next;
    options.onDragChange(next);
  }

  function reset() {
    counter = 0;
    setDragging(false);
  }

  function isActive(event: DragEvent): boolean {
    if (options.isEnabled && !options.isEnabled()) return false;
    return isFileDragEvent(event);
  }

  return {
    handleDragEnter(event) {
      if (!isActive(event)) return;
      event.preventDefault();
      counter++;
      setDragging(true);
    },
    handleDragLeave(event) {
      if (!isActive(event)) return;
      event.preventDefault();
      counter = Math.max(0, counter - 1);
      if (counter === 0) setDragging(false);
    },
    handleDragOver(event) {
      // preventDefault marks the target as a valid drop zone.
      if (!isActive(event)) return;
      event.preventDefault();
    },
    handleDrop(event) {
      if (!isActive(event)) return;
      event.preventDefault();
      reset();
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        options.onDrop(Array.from(files));
      }
    },
    reset,
  };
}
