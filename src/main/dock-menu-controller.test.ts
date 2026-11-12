import { describe, expect, it, vi } from 'vitest';
import { createDockMenuController, type DockMenuWindow } from './dock-menu-controller';

function fixture(saved = true) {
  const listeners = new WeakMap<DockMenuWindow, () => void>();
  let current: DockMenuWindow | null = null;
  const createWindow = vi.fn(() => {
    if (!current) {
      const window: DockMenuWindow = {
        on: (_event, listener) => listeners.set(window, listener),
      };
      current = window;
    }
    return current;
  });
  const writeEnabledPreference = vi.fn(async (enabled: boolean) => {
    saved = enabled;
  });
  const closeWindow = vi.fn(() => {
    const closed = current;
    current = null;
    if (closed) listeners.get(closed)?.();
  });
  const onStateChange = vi.fn();
  const controller = createDockMenuController({
    createWindow,
    getWindow: () => current,
    closeWindow,
    focusWindow: vi.fn(),
    readEnabledPreference: async () => saved,
    writeEnabledPreference,
    onStateChange,
  });
  return {
    controller,
    createWindow,
    closeWindow,
    writeEnabledPreference,
    onStateChange,
    replaceWindow: () => {
      current = null;
      return createWindow();
    },
  };
}

describe('Dock visibility preference ownership', () => {
  it('restores an enabled Dock without rewriting its preference', async () => {
    const f = fixture();
    expect(await f.controller.restore()).toBe(true);
    expect(f.createWindow).toHaveBeenCalledOnce();
    expect(f.writeEnabledPreference).not.toHaveBeenCalled();
  });

  it('respects an intentional saved hide at startup', async () => {
    const f = fixture(false);
    expect(await f.controller.restore()).toBe(false);
    expect(f.createWindow).not.toHaveBeenCalled();
  });

  it('does not turn a failed or externally closed window into a saved hide', async () => {
    const f = fixture();
    await f.controller.restore();
    f.closeWindow();
    expect(f.writeEnabledPreference).not.toHaveBeenCalled();
    expect(f.onStateChange).toHaveBeenCalledOnce();
    expect(await f.controller.restore()).toBe(true);
  });

  it('remembers an explicit user hide and allows an explicit show to restore it', async () => {
    const f = fixture();
    await f.controller.restore();
    await f.controller.setEnabled(false);
    expect(f.writeEnabledPreference).toHaveBeenLastCalledWith(false);
    expect(f.closeWindow).toHaveBeenCalledOnce();
    expect(await f.controller.restore()).toBe(false);
    await f.controller.setEnabled(true);
    expect(f.writeEnabledPreference).toHaveBeenLastCalledWith(true);
    expect(f.controller.isEnabled()).toBe(true);
  });

  it('dismisses for the Labs setting without overwriting the visibility preference', async () => {
    const f = fixture();
    await f.controller.restore();
    f.controller.dismiss();
    expect(f.closeWindow).toHaveBeenCalledOnce();
    expect(f.writeEnabledPreference).not.toHaveBeenCalled();
    expect(await f.controller.restore()).toBe(true);
  });

  it('does not close a replacement window after an older hide finishes saving', async () => {
    const f = fixture();
    await f.controller.restore();
    let finishWrite!: () => void;
    f.writeEnabledPreference.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishWrite = resolve)),
    );
    const hiding = f.controller.setEnabled(false);
    f.replaceWindow();
    finishWrite();
    await hiding;
    expect(f.closeWindow).not.toHaveBeenCalled();
    expect(f.controller.isEnabled()).toBe(true);
  });
});
