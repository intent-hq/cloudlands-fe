import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createDockMenuController, type DockMenuWindow } from '../dock-menu-controller';

function createHarness(saved = false, closeSynchronously = true) {
  let window: DockMenuWindow | null = null;
  let savedEnabled = saved;
  const closedListeners: Array<() => void> = [];
  const fakeWindow: DockMenuWindow = {
    on: (_event, listener) => closedListeners.push(listener),
  };
  const deps = {
    createWindow: vi.fn(() => {
      window = fakeWindow;
      return fakeWindow;
    }),
    getWindow: vi.fn(() => window),
    closeWindow: vi.fn(() => {
      if (closeSynchronously) {
        window = null;
        closedListeners.forEach((listener) => listener());
      }
    }),
    focusWindow: vi.fn(),
    readEnabledPreference: vi.fn(async () => savedEnabled),
    writeEnabledPreference: vi.fn(async (enabled: boolean) => {
      savedEnabled = enabled;
    }),
    onStateChange: vi.fn(),
  };
  return {
    controller: createDockMenuController(deps),
    deps,
    manualClose: () => {
      window = null;
      closedListeners.forEach((listener) => listener());
    },
  };
}

describe('dock menu controller', () => {
  it('enables, persists, and focuses the live dock', async () => {
    const { controller, deps } = createHarness();
    await controller.setEnabled(true);
    expect(controller.isEnabled()).toBe(true);
    expect(deps.writeEnabledPreference).toHaveBeenCalledWith(true);
    expect(controller.focus()).toBe(true);
    expect(deps.focusWindow).toHaveBeenCalledOnce();
  });

  it('disables and persists before it closes the dock', async () => {
    const { controller, deps } = createHarness();
    await controller.setEnabled(true);
    await controller.setEnabled(false);
    expect(controller.isEnabled()).toBe(false);
    expect(deps.writeEnabledPreference.mock.calls).toEqual([[true], [false]]);
    expect(deps.closeWindow).toHaveBeenCalledOnce();
  });

  it('waits for an asynchronous closed event before it updates checked state', async () => {
    const { controller, deps, manualClose } = createHarness(false, false);
    await controller.setEnabled(true);
    deps.onStateChange.mockClear();
    await controller.setEnabled(false);
    expect(controller.isEnabled()).toBe(true);
    expect(deps.onStateChange).not.toHaveBeenCalled();

    manualClose();
    await vi.waitFor(() => expect(deps.onStateChange).toHaveBeenCalledOnce());
    expect(controller.isEnabled()).toBe(false);
  });

  it('saves disabled state and updates the menu after a manual close', async () => {
    const { controller, deps, manualClose } = createHarness();
    await controller.setEnabled(true);
    manualClose();
    await vi.waitFor(() => expect(deps.writeEnabledPreference).toHaveBeenLastCalledWith(false));
    expect(controller.isEnabled()).toBe(false);
    expect(deps.onStateChange).toHaveBeenCalledTimes(2);
  });

  it('restores only a saved enabled dock and leaves it unfocused', async () => {
    const enabled = createHarness(true);
    expect(await enabled.controller.restore()).toBe(true);
    expect(enabled.deps.createWindow).toHaveBeenCalledOnce();
    expect(enabled.deps.focusWindow).not.toHaveBeenCalled();

    const disabled = createHarness(false);
    expect(await disabled.controller.restore()).toBe(false);
    expect(disabled.deps.createWindow).not.toHaveBeenCalled();
  });

  it('wires the checked toggle and keyboard focus command into the Window menu', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/main/index.ts'), 'utf8');
    expect(source).toMatch(/label: m\.menu_show_intent_dock\(\),\s*type: 'checkbox'/);
    expect(source).toContain('checked: dockMenuController.isEnabled()');
    expect(source).toMatch(
      /label: m\.menu_focus_intent_dock\(\),\s*accelerator: 'CmdOrCtrl\+Shift\+D'/,
    );
    expect(source).toContain('await dockMenuController.restore()');
  });
});
