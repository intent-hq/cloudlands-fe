import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), setDock: vi.fn() }));
vi.mock('$lib/dock-lab', () => ({ setDockLabEnabled: mocks.setDock }));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));

import { isLabCommandHidden, runLabCommand } from './command-palette-labs';
import {
  setLabsBrowserAccessEnabled,
  setLabsCursorProviderEnabled,
  setLabsPlainFolderWorkspacesEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { setBrowserAccessEnabledRequested } from '$store/renderer/slices/browser-access/browser-access-slice';

describe('command palette Labs commands', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.setDock.mockClear();
  });

  it('hides only the command that would set each lab to its current value', () => {
    expect(isLabCommandHidden('enable-experimental-dock', true, false)).toBe(true);
    expect(isLabCommandHidden('disable-experimental-dock', true, false)).toBe(false);
    expect(isLabCommandHidden('enable-experimental-plain-folders', false, true)).toBe(true);
    expect(isLabCommandHidden('disable-experimental-plain-folders', false, true)).toBe(false);
    expect(isLabCommandHidden('disable-experimental-plain-folders', false, false)).toBe(true);
    expect(isLabCommandHidden('enable-experimental-plain-folders', false, false)).toBe(false);
    expect(isLabCommandHidden('new-workspace', false, false)).toBe(false);
  });

  it('toggles plain-folder workspaces through the preferences slice', () => {
    expect(runLabCommand('enable-experimental-plain-folders')).toBe(true);
    expect(runLabCommand('disable-experimental-plain-folders')).toBe(true);
    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      setLabsPlainFolderWorkspacesEnabled(true),
      setLabsPlainFolderWorkspacesEnabled(false),
    ]);
    expect(mocks.setDock).not.toHaveBeenCalled();
  });

  it('hides the browser access command matching its current value', () => {
    expect(isLabCommandHidden('enable-experimental-browser-access', false, false, true)).toBe(true);
    expect(isLabCommandHidden('disable-experimental-browser-access', false, false, true)).toBe(
      false,
    );
    expect(isLabCommandHidden('disable-experimental-browser-access', false, false, false)).toBe(
      true,
    );
    expect(isLabCommandHidden('enable-experimental-browser-access', false, false, false)).toBe(
      false,
    );
  });

  it('turns browser access on and off, stopping the server when it is hidden', () => {
    expect(runLabCommand('enable-experimental-browser-access')).toBe(true);
    expect(runLabCommand('disable-experimental-browser-access')).toBe(true);
    const actions = mocks.dispatch.mock.calls.map(([action]) => action);
    expect(actions[0]).toEqual(setLabsBrowserAccessEnabled(true));
    expect(actions[1]).toEqual(setLabsBrowserAccessEnabled(false));
    expect(actions[2]?.type).toBe(setBrowserAccessEnabledRequested(false).type);
    expect(actions[2]?.payload).toEqual([false]);
    expect(actions).toHaveLength(3);
  });

  it('hides the Cursor command matching its current value', () => {
    expect(isLabCommandHidden('enable-experimental-cursor', false, false, false, true)).toBe(true);
    expect(isLabCommandHidden('disable-experimental-cursor', false, false, false, true)).toBe(false);
    expect(isLabCommandHidden('disable-experimental-cursor', false, false, false, false)).toBe(true);
    expect(isLabCommandHidden('enable-experimental-cursor', false, false, false, false)).toBe(false);
  });

  it('turns the Cursor lab on and off without touching providers.enabled', () => {
    expect(runLabCommand('enable-experimental-cursor')).toBe(true);
    expect(runLabCommand('disable-experimental-cursor')).toBe(true);
    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      setLabsCursorProviderEnabled(true),
      setLabsCursorProviderEnabled(false),
    ]);
    expect(mocks.setDock).not.toHaveBeenCalled();
  });

  it('still toggles the dock and ignores other commands', () => {
    expect(runLabCommand('enable-experimental-dock')).toBe(true);
    expect(mocks.setDock).toHaveBeenCalledWith(true);
    expect(runLabCommand('new-workspace')).toBe(false);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
