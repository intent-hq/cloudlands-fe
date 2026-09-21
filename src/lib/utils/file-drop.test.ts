import { describe, expect, it, vi } from 'vitest';
import { createFileDropTarget } from './file-drop';

function makeDragEvent(types: string[] | undefined, files: File[] = []): DragEvent {
  return {
    preventDefault: vi.fn(),
    dataTransfer: types ? ({ types, files } as unknown as DataTransfer) : null,
  } as unknown as DragEvent;
}

function makeItem(file: File, entry: { isDirectory: boolean } | null) {
  return {
    kind: 'file',
    getAsFile: () => file,
    webkitGetAsEntry: () => entry,
  } as unknown as DataTransferItem;
}

/** Drag event whose dataTransfer carries items, so folder entries are detectable. */
function makeItemsDropEvent(items: DataTransferItem[]): DragEvent {
  return {
    preventDefault: vi.fn(),
    dataTransfer: { types: ['Files'], items, files: [] } as unknown as DataTransfer,
  } as unknown as DragEvent;
}

const fileTypes = ['Files'];

describe('createFileDropTarget (ChatPanel full-panel drop zone)', () => {
  it('flips dragging on for a file dragenter and off when the last leave fires', () => {
    const onDragChange = vi.fn();
    const target = createFileDropTarget({ onDragChange, onDrop: vi.fn() });

    target.handleDragEnter(makeDragEvent(fileTypes));
    expect(onDragChange).toHaveBeenCalledWith(true);

    // Nested element transition: enter child, leave parent → still dragging.
    target.handleDragEnter(makeDragEvent(fileTypes));
    target.handleDragLeave(makeDragEvent(fileTypes));
    expect(onDragChange).not.toHaveBeenCalledWith(false);

    target.handleDragLeave(makeDragEvent(fileTypes));
    expect(onDragChange).toHaveBeenLastCalledWith(false);
  });

  it('ignores text/content drags entirely (no state, no preventDefault)', () => {
    const onDragChange = vi.fn();
    const onDrop = vi.fn();
    const target = createFileDropTarget({ onDragChange, onDrop });

    const enter = makeDragEvent(['text/plain', 'text/html']);
    target.handleDragEnter(enter);
    target.handleDragOver(enter);
    target.handleDrop(enter);

    expect(onDragChange).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    expect(enter.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores drags with no dataTransfer', () => {
    const onDragChange = vi.fn();
    const target = createFileDropTarget({ onDragChange, onDrop: vi.fn() });

    target.handleDragEnter(makeDragEvent(undefined));
    expect(onDragChange).not.toHaveBeenCalled();
  });

  it('prevents default on dragover for file drags to mark a valid drop zone', () => {
    const target = createFileDropTarget({ onDragChange: vi.fn(), onDrop: vi.fn() });
    const over = makeDragEvent(fileTypes);

    target.handleDragOver(over);
    expect(over.preventDefault).toHaveBeenCalled();
  });

  it('delivers dropped files to onDrop as a DropSplit and clears the drag state', () => {
    const onDragChange = vi.fn();
    const onDrop = vi.fn();
    const target = createFileDropTarget({ onDragChange, onDrop });
    const file = new File(['x'], 'cat.png', { type: 'image/png' });

    target.handleDragEnter(makeDragEvent(fileTypes));
    target.handleDrop(makeDragEvent(fileTypes, [file]));

    expect(onDrop).toHaveBeenCalledWith({ files: [file], folderFiles: [] });
    expect(onDragChange).toHaveBeenLastCalledWith(false);
  });

  it('splits folders from files at drop time and forwards both in the DropSplit', () => {
    const onDrop = vi.fn();
    const target = createFileDropTarget({ onDragChange: vi.fn(), onDrop });
    const file = new File(['x'], 'cat.png', { type: 'image/png' });
    const folder = new File([], 'my-folder', { type: '' });

    target.handleDrop(
      makeItemsDropEvent([
        makeItem(file, { isDirectory: false }),
        makeItem(folder, { isDirectory: true }),
      ]),
    );

    expect(onDrop).toHaveBeenCalledWith({ files: [file], folderFiles: [folder] });
  });

  it('forwards a folder-only drop (no regular files) to onDrop', () => {
    const onDrop = vi.fn();
    const target = createFileDropTarget({ onDragChange: vi.fn(), onDrop });
    const folder = new File([], 'my-folder', { type: '' });

    target.handleDrop(makeItemsDropEvent([makeItem(folder, { isDirectory: true })]));

    expect(onDrop).toHaveBeenCalledWith({ files: [], folderFiles: [folder] });
  });

  it('does not call onDrop when the drop carries no files', () => {
    const onDrop = vi.fn();
    const target = createFileDropTarget({ onDragChange: vi.fn(), onDrop });

    target.handleDrop(makeDragEvent(fileTypes, []));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('reset() clears mid-drag state (target unmounted mid-drag)', () => {
    const onDragChange = vi.fn();
    const target = createFileDropTarget({ onDragChange, onDrop: vi.fn() });

    target.handleDragEnter(makeDragEvent(fileTypes));
    target.handleDragEnter(makeDragEvent(fileTypes));
    target.reset();
    expect(onDragChange).toHaveBeenLastCalledWith(false);

    // Counter fully cleared: a fresh enter/leave pair works as from scratch.
    target.handleDragEnter(makeDragEvent(fileTypes));
    expect(onDragChange).toHaveBeenLastCalledWith(true);
    target.handleDragLeave(makeDragEvent(fileTypes));
    expect(onDragChange).toHaveBeenLastCalledWith(false);
  });

  it('ignores all events while isEnabled() returns false (drop consumer unavailable)', () => {
    let enabled = false;
    const onDragChange = vi.fn();
    const onDrop = vi.fn();
    const target = createFileDropTarget({ onDragChange, onDrop, isEnabled: () => enabled });
    const file = new File(['x'], 'cat.png', { type: 'image/png' });

    const enter = makeDragEvent(fileTypes);
    target.handleDragEnter(enter);
    target.handleDragOver(enter);
    target.handleDrop(makeDragEvent(fileTypes, [file]));

    expect(onDragChange).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    expect(enter.preventDefault).not.toHaveBeenCalled();

    // Re-enabling restores normal behavior from a clean state.
    enabled = true;
    target.handleDragEnter(makeDragEvent(fileTypes));
    expect(onDragChange).toHaveBeenLastCalledWith(true);
    target.handleDrop(makeDragEvent(fileTypes, [file]));
    expect(onDrop).toHaveBeenCalledWith({ files: [file], folderFiles: [] });
  });

  it('leave without a matching enter never underflows the counter', () => {
    const onDragChange = vi.fn();
    const target = createFileDropTarget({ onDragChange, onDrop: vi.fn() });

    target.handleDragLeave(makeDragEvent(fileTypes));
    target.handleDragEnter(makeDragEvent(fileTypes));
    expect(onDragChange).toHaveBeenLastCalledWith(true);
    target.handleDragLeave(makeDragEvent(fileTypes));
    expect(onDragChange).toHaveBeenLastCalledWith(false);
  });
});
