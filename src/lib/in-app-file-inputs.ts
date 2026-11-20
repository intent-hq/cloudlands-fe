/**
 * In-app stand-in for `<input type=file>` choosers (INTENT_IN_APP_PICKER).
 *
 * Electron opens a file input's chooser natively, which does nothing on Intent
 * OS. {@link installInAppFileInputs} catches every click that would open one
 * (user clicks, `<label for>` clicks and programmatic `input.click()` all
 * dispatch a click on the input), cancels it, asks main for the in-app picker
 * and then fills the input as the native chooser would: `files` is set and
 * `input` + `change` fire, so existing `onchange` / `bind:files` code runs
 * unchanged. Inputs must be in the document for the capture listener to see
 * them (`file-dialogs.guard.test.ts`).
 */
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { InAppPickedFile, InAppPickFilesRequest } from '$shared/in-app-file-dialog';

const logger = createLogger('InAppFileInputs');

type Bridge = Pick<Window['electronAPI'], 'invoke'>;

/** Whether this session must replace native choosers with the in-app picker. */
export function prefersInAppFilePicker(win: Window | undefined = globalThis.window): boolean {
  return win?.electronAPI?.preferInAppPicker === true;
}

function isFileInput(target: EventTarget | null): target is HTMLInputElement {
  return (
    typeof HTMLInputElement !== 'undefined' &&
    target instanceof HTMLInputElement &&
    target.type === 'file'
  );
}

/**
 * Disk paths of the files this module put into inputs, keyed by the `File`
 * objects themselves. Only main's answer to a user's pick fills it (no setter
 * is exported), so other renderer code cannot plant a path here.
 */
const pickedFilePaths = new WeakMap<File, string>();

/**
 * The host path behind a `File`, for path-based attachment placement.
 * Native choosers and drops expose it through `electronAPI.getPathForFile`;
 * files from the in-app picker are rebuilt from bytes, so that returns '' and
 * the path main approved for the pick is used instead. '' when neither knows.
 */
export function sourcePathForFile(file: File, win: Window | undefined = globalThis.window): string {
  let nativePath = '';
  try {
    nativePath = win?.electronAPI?.getPathForFile?.(file) ?? '';
  } catch {
    nativePath = '';
  }
  return nativePath || pickedFilePaths.get(file) || '';
}

/** Build the `FileList` the native chooser would have produced. */
function toFileList(picked: readonly InAppPickedFile[]): FileList {
  const transfer = new DataTransfer();
  for (const file of picked) {
    transfer.items.add(new File([file.data as BlobPart], file.name, { type: file.type }));
  }
  return transfer.files;
}

/**
 * Run the in-app picker for `input` and fill it. Resolves `false` when the
 * user cancels (the input keeps its previous files, like a native cancel).
 * @internal
 */
export async function pickIntoFileInput(
  input: HTMLInputElement,
  electronAPI: Bridge,
): Promise<boolean> {
  const request: InAppPickFilesRequest = {
    accept: input.accept || undefined,
    multiple: input.multiple,
  };
  const picked = (await electronAPI.invoke(IPC_CHANNELS.IN_APP_FILE_DIALOG.PICK_FILES, request)) as
    InAppPickedFile[] | null;
  if (!Array.isArray(picked) || picked.length === 0) {
    input.dispatchEvent(new Event('cancel', { bubbles: true }));
    return false;
  }
  input.files = toFileList(picked);
  // Key by the Files the input now holds: those are what change handlers read.
  Array.from(input.files ?? [], (file, index) => {
    const path = picked[index]?.path;
    if (path) pickedFilePaths.set(file, path);
  });
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/**
 * Install the click capture on `win` when the session prefers the in-app
 * picker. Returns a disposer (a no-op when nothing was installed).
 */
export function installInAppFileInputs(win: Window | undefined = globalThis.window): () => void {
  if (!win || !prefersInAppFilePicker(win)) return () => {};
  const electronAPI: Bridge = win.electronAPI;
  let busy = false;
  const onClick = (event: MouseEvent) => {
    const input = event.target;
    if (!isFileInput(input) || input.disabled) return;
    event.preventDefault();
    if (busy) return;
    busy = true;
    void pickIntoFileInput(input, electronAPI)
      .catch((error: unknown) => {
        logger.warn('in-app picker failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        busy = false;
      });
  };
  win.addEventListener('click', onClick, true);
  return () => win.removeEventListener('click', onClick, true);
}
