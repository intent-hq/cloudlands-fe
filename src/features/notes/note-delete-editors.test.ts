import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareNoteDeleteEditors, registerNoteDeleteEditor } from './note-delete-editors';

const scope = { backendGeneration: 1, workspaceId: 'ws', noteId: 'note' };
const retire: Array<() => void> = [];
afterEach(() => {
  retire
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
});
function participant(
  overrides: Partial<Parameters<typeof registerNoteDeleteEditor>[1]> = {},
  target: typeof scope & { noteInstanceId?: string } = scope,
) {
  const callbacks = {
    current: () => true,
    version: () => 0,
    dirty: () => false,
    composing: () => false,
    hold: vi.fn(),
    flush: vi.fn(async () => {}),
    ...overrides,
  };
  const registration = registerNoteDeleteEditor(target, callbacks);
  retire.push(registration.unregister);
  return { ...callbacks, ...registration };
}

describe('note delete editor ownership', () => {
  it('freezes every participant synchronously and waits for actual acknowledgement', async () => {
    let acknowledge!: () => void;
    const first = participant({
      dirty: () => true,
      flush: vi.fn(
        () =>
          new Promise<void>((r) => {
            acknowledge = r;
          }),
      ),
    });
    const second = participant();
    let completed = false;
    const pending = prepareNoteDeleteEditors(scope).then((h) => {
      completed = true;
      return h;
    });
    expect(first.hold).toHaveBeenCalledWith(true);
    expect(second.hold).toHaveBeenCalledWith(true);
    await vi.waitFor(() => expect(first.flush).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    acknowledge();
    const held = await pending;
    retire.push(held.release);
    expect(held.current()).toBe(true);
    expect(first.hold).not.toHaveBeenCalledWith(false);
    held.release();
    expect(first.hold).toHaveBeenLastCalledWith(false);
    expect(held.current()).toBe(false);
  });

  it('preserves two competing drafts without flushing either', async () => {
    const first = participant({ dirty: () => true });
    const second = participant({ dirty: () => true });
    await expect(prepareNoteDeleteEditors(scope)).rejects.toThrow();
    expect(first.flush).not.toHaveBeenCalled();
    expect(second.flush).not.toHaveBeenCalled();
    expect(first.hold).toHaveBeenLastCalledWith(false);
  });

  it('refuses active composition before any flush', async () => {
    const editor = participant({ composing: () => true });
    await expect(prepareNoteDeleteEditors(scope)).rejects.toThrow();
    expect(editor.flush).not.toHaveBeenCalled();
  });

  it('invalidates typing in the readonly render gap before dispatching a save', async () => {
    let version = 0;
    const editor = participant({ version: () => version });
    const pending = prepareNoteDeleteEditors(scope);
    version++;
    editor.invalidate();
    await expect(pending).rejects.toThrow();
    expect(editor.flush).not.toHaveBeenCalled();
  });

  it.each(['new mount', 'unmount', 'rebind'] as const)(
    'rejects changed ownership: %s',
    async (change) => {
      let bound = true;
      const editor = participant({ current: () => bound });
      const pending = prepareNoteDeleteEditors(scope);
      if (change === 'new mount') {
        const newcomer = participant();
        expect(newcomer.hold).toHaveBeenCalledWith(true);
      } else if (change === 'unmount') editor.unregister();
      else bound = false;
      await expect(pending).rejects.toThrow();
      expect(editor.flush).not.toHaveBeenCalled();
    },
  );

  it('keeps failure visible and releases only the preparation hold', async () => {
    const editor = participant({
      flush: vi.fn(async () => {
        throw new Error('conflict');
      }),
    });
    await expect(prepareNoteDeleteEditors(scope)).rejects.toThrow('conflict');
    expect(editor.hold).toHaveBeenLastCalledWith(false);
  });

  it('does not consult another backend with identical note IDs', async () => {
    const foreign = participant(
      { dirty: () => true, composing: () => true },
      { ...scope, backendGeneration: 2 },
    );
    const held = await prepareNoteDeleteEditors(scope);
    retire.push(held.release);
    expect(held.current()).toBe(true);
    expect(foreign.hold).not.toHaveBeenCalled();
    expect(foreign.flush).not.toHaveBeenCalled();
  });

  it('blocks incomplete ownership until the exact overflow registration retires', async () => {
    for (let i = 0; i < 32; i++) participant();
    const overflow = participant();
    expect(overflow.registered).toBe(false);
    expect(overflow.hold).toHaveBeenCalledWith(true);
    await expect(prepareNoteDeleteEditors(scope)).rejects.toThrow();
    overflow.unregister();
    overflow.unregister();
    const held = await prepareNoteDeleteEditors(scope);
    retire.push(held.release);
    expect(held.current()).toBe(true);
  });

  it('enforces the global participant bound without retaining overflow callbacks', async () => {
    for (let i = 0; i < 256; i++) participant({}, { ...scope, noteId: String(i) });
    const overflow = participant();
    await expect(prepareNoteDeleteEditors(scope)).rejects.toThrow();
    overflow.unregister();
    const held = await prepareNoteDeleteEditors(scope);
    retire.push(held.release);
    expect(held.current()).toBe(true);
  });

  it('rejects duplicate preparation and invalidates a completed lease on later input', async () => {
    const editor = participant();
    const held = await prepareNoteDeleteEditors(scope);
    retire.push(held.release);
    await expect(prepareNoteDeleteEditors(scope)).rejects.toThrow();
    editor.invalidate();
    expect(held.current()).toBe(false);
    expect(editor.hold).not.toHaveBeenCalledWith(false);
  });
  it('rejects a known note incarnation mismatch without flushing', async () => {
    const editor = participant({}, { ...scope, noteInstanceId: 'old-incarnation' });
    await expect(
      prepareNoteDeleteEditors({ ...scope, noteInstanceId: 'new-incarnation' }),
    ).rejects.toThrow();
    expect(editor.flush).not.toHaveBeenCalled();
  });

  it('invalidates unmount after settlement without retaining the retired callback in release', async () => {
    const editor = participant();
    const held = await prepareNoteDeleteEditors(scope);
    retire.push(held.release);
    editor.unregister();
    expect(held.current()).toBe(false);
    held.release();
    expect(editor.hold).not.toHaveBeenCalledWith(false);
  });
  it('compares the authoritative instance received after flush with every known editor instance', async () => {
    participant({}, { ...scope, noteInstanceId: 'original' });
    participant();
    const held = await prepareNoteDeleteEditors(scope);
    retire.push(held.release);
    expect(held.current('original')).toBe(true);
    expect(held.current('replacement')).toBe(false);
  });

  it('retains the initially captured instance guard even when no editor knows the instance', async () => {
    participant();
    const held = await prepareNoteDeleteEditors({ ...scope, noteInstanceId: 'original' });
    retire.push(held.release);
    expect(held.current('replacement')).toBe(false);
    expect(held.current('original')).toBe(true);
  });

  it('refuses mixed known editor incarnations before flushing any draft', async () => {
    const first = participant({}, { ...scope, noteInstanceId: 'original' });
    const second = participant({}, { ...scope, noteInstanceId: 'replacement' });
    await expect(prepareNoteDeleteEditors(scope)).rejects.toThrow();
    expect(first.flush).not.toHaveBeenCalled();
    expect(second.flush).not.toHaveBeenCalled();
  });
});
