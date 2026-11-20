/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { installInAppFileInputs, pickIntoFileInput } from './in-app-file-inputs';

// jsdom has no DataTransfer; a minimal one is enough for FileList building.
class FakeDataTransfer {
  private list: File[] = [];
  items = { add: (file: File) => this.list.push(file) };
  get files(): FileList {
    const list = [...this.list];
    return Object.assign(list, { item: (i: number) => list[i] ?? null }) as unknown as FileList;
  }
}
vi.stubGlobal('DataTransfer', FakeDataTransfer);

function fileInput(attrs: Partial<HTMLInputElement> = {}): HTMLInputElement {
  const input = document.createElement('input');
  input.setAttribute('type', 'file');
  Object.assign(input, attrs);
  // jsdom only accepts real FileLists for `files`; make it writable.
  let files: FileList | null = null;
  Object.defineProperty(input, 'files', { get: () => files, set: (v) => (files = v) });
  document.body.append(input);
  return input;
}

afterEach(() => {
  document.body.replaceChildren();
  delete (window as { electronAPI?: unknown }).electronAPI;
});

describe('pickIntoFileInput', () => {
  it('fills the input and fires change with the picked files', async () => {
    const input = fileInput({ accept: '.png', multiple: true });
    const onChange = vi.fn();
    input.addEventListener('change', onChange);
    const invoke = vi.fn(async () => [
      { name: 'a.png', path: '/a.png', type: 'image/png', data: new Uint8Array([1, 2]) },
      { name: 'b.png', path: '/b.png', type: 'image/png', data: new Uint8Array([3]) },
    ]);

    await expect(pickIntoFileInput(input, { invoke })).resolves.toBe(true);

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.IN_APP_FILE_DIALOG.PICK_FILES, {
      accept: '.png',
      multiple: true,
    });
    expect(Array.from(input.files ?? [], (file) => [file.name, file.type, file.size])).toEqual([
      ['a.png', 'image/png', 2],
      ['b.png', 'image/png', 1],
    ]);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('leaves the input alone on cancel', async () => {
    const input = fileInput();
    const onChange = vi.fn();
    input.addEventListener('change', onChange);
    await expect(pickIntoFileInput(input, { invoke: vi.fn(async () => null) })).resolves.toBe(
      false,
    );
    expect(input.files).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('installInAppFileInputs', () => {
  it('does nothing when the session allows native choosers', () => {
    const invoke = vi.fn();
    (window as { electronAPI?: unknown }).electronAPI = { invoke, preferInAppPicker: false };
    const dispose = installInAppFileInputs(window);
    const input = fileInput();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    input.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    dispose();
  });

  it('cancels the native chooser and opens the in-app picker instead', async () => {
    const invoke = vi.fn(async () => null);
    (window as { electronAPI?: unknown }).electronAPI = { invoke, preferInAppPicker: true };
    const dispose = installInAppFileInputs(window);
    const input = fileInput({ multiple: true });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    input.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.IN_APP_FILE_DIALOG.PICK_FILES, {
      accept: undefined,
      multiple: true,
    });
    dispose();
  });

  it('ignores disabled inputs and other clicks', () => {
    const invoke = vi.fn(async () => null);
    (window as { electronAPI?: unknown }).electronAPI = { invoke, preferInAppPicker: true };
    const dispose = installInAppFileInputs(window);
    fileInput({ disabled: true }).click();
    document.body.click();
    expect(invoke).not.toHaveBeenCalled();
    dispose();
  });
});
