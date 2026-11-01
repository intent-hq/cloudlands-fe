import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), setDock: vi.fn() }));
vi.mock('$lib/dock-lab', () => ({ setDockLabEnabled: mocks.setDock }));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));

import { isLabCommandHidden, runLabCommand } from './command-palette-labs';
import { setLabsPlainFolderWorkspacesEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';

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

  it('still toggles the dock and ignores other commands', () => {
    expect(runLabCommand('enable-experimental-dock')).toBe(true);
    expect(mocks.setDock).toHaveBeenCalledWith(true);
    expect(runLabCommand('new-workspace')).toBe(false);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
