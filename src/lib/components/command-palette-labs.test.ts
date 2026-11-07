import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  setDock: vi.fn(),
  electron: { value: true },
  groupByProject: vi.fn<() => (() => void) | undefined>(),
}));
vi.mock('$lib/dock-lab', () => ({ setDockLabEnabled: mocks.setDock }));
vi.mock('$lib/utils/platform-capabilities', () => ({
  isElectronPlatform: () => mocks.electron.value,
}));
vi.mock('$lib/components/layout/workspace-tab-group-controller', () => ({
  groupTabsByProjectAction: mocks.groupByProject,
}));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));

import {
  isLabCommandHidden,
  isSshMachineSetupCommandHidden,
  runLabCommand,
} from './command-palette-labs';
import {
  setLabsBrowserAccessEnabled,
  setLabsCloudMachinesEnabled,
  setLabsSshMachineSetupEnabled,
  setLabsPlainFolderWorkspacesEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { setBrowserAccessEnabledRequested } from '$store/renderer/slices/browser-access/browser-access-slice';

describe('command palette Labs commands', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.setDock.mockClear();
    mocks.electron.value = true;
  });

  it('offers SSH machine setup in the desktop app only, hiding the no-op command', () => {
    expect(isSshMachineSetupCommandHidden('enable-experimental-ssh-machine-setup', false)).toBe(
      false,
    );
    expect(isSshMachineSetupCommandHidden('disable-experimental-ssh-machine-setup', false)).toBe(
      true,
    );
    expect(isSshMachineSetupCommandHidden('enable-experimental-ssh-machine-setup', true)).toBe(
      true,
    );
    expect(isSshMachineSetupCommandHidden('new-workspace', true)).toBe(false);
    mocks.electron.value = false;
    expect(isSshMachineSetupCommandHidden('enable-experimental-ssh-machine-setup', false)).toBe(
      true,
    );
    expect(isSshMachineSetupCommandHidden('disable-experimental-ssh-machine-setup', true)).toBe(
      true,
    );
  });

  it('toggles SSH machine setup through the preferences slice', () => {
    expect(runLabCommand('enable-experimental-ssh-machine-setup')).toBe(true);
    expect(runLabCommand('disable-experimental-ssh-machine-setup')).toBe(true);
    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      setLabsSshMachineSetupEnabled(true),
      setLabsSshMachineSetupEnabled(false),
    ]);
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

  it('hides the E2B command matching its current value and toggles it', () => {
    expect(
      isLabCommandHidden('enable-experimental-cloud-machines', false, false, false, false, true),
    ).toBe(true);
    expect(
      isLabCommandHidden('disable-experimental-cloud-machines', false, false, false, false, true),
    ).toBe(false);
    expect(isLabCommandHidden('disable-experimental-cloud-machines', false)).toBe(true);
    expect(runLabCommand('enable-experimental-cloud-machines')).toBe(true);
    expect(runLabCommand('disable-experimental-cloud-machines')).toBe(true);
    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      setLabsCloudMachinesEnabled(true),
      setLabsCloudMachinesEnabled(false),
    ]);
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

  it('groups tabs by project only while tab groups are on', () => {
    expect(isLabCommandHidden('group-tabs-by-project', false, false, false, false)).toBe(true);
    expect(isLabCommandHidden('group-tabs-by-project', false, false, false, true)).toBe(false);
    const group = vi.fn();
    mocks.groupByProject.mockReturnValueOnce(group).mockReturnValueOnce(undefined);
    expect(runLabCommand('group-tabs-by-project')).toBe(true);
    expect(runLabCommand('group-tabs-by-project')).toBe(true);
    expect(group).toHaveBeenCalledTimes(1);
  });

  it('still toggles the dock and ignores other commands', () => {
    expect(runLabCommand('enable-experimental-dock')).toBe(true);
    expect(mocks.setDock).toHaveBeenCalledWith(true);
    expect(runLabCommand('new-workspace')).toBe(false);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
