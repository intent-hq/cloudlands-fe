import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), setDock: vi.fn(), electron: true }));
vi.mock('$lib/dock-lab', () => ({ setDockLabEnabled: mocks.setDock }));
vi.mock('$lib/utils/platform-capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/platform-capabilities')>()),
  isElectronPlatform: () => mocks.electron,
}));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));

import {
  isLabCommandHidden,
  isLocalPairingCommandHidden,
  runLabCommand,
} from './command-palette-labs';
import {
  setLabsBrowserAccessEnabled,
  setLabsCloudMachinesEnabled,
  setLabsLocalPairingEnabled,
  setLabsPlainFolderWorkspacesEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { setBrowserAccessEnabledRequested } from '$store/renderer/slices/browser-access/browser-access-slice';

describe('command palette Labs commands', () => {
  beforeEach(() => {
    mocks.electron = true;
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

  it('offers the local pairing command that changes the setting, in the desktop app only', () => {
    expect(isLocalPairingCommandHidden('enable-experimental-local-pairing', false)).toBe(false);
    expect(isLocalPairingCommandHidden('disable-experimental-local-pairing', false)).toBe(true);
    expect(isLocalPairingCommandHidden('enable-experimental-local-pairing', true)).toBe(true);
    expect(isLocalPairingCommandHidden('disable-experimental-local-pairing', true)).toBe(false);
    expect(isLocalPairingCommandHidden('new-workspace', true)).toBe(false);
    mocks.electron = false;
    expect(isLocalPairingCommandHidden('enable-experimental-local-pairing', false)).toBe(true);
    expect(isLocalPairingCommandHidden('disable-experimental-local-pairing', true)).toBe(true);
  });

  it('turns local pairing on and off through the preferences slice', () => {
    expect(runLabCommand('enable-experimental-local-pairing')).toBe(true);
    expect(runLabCommand('disable-experimental-local-pairing')).toBe(true);
    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      setLabsLocalPairingEnabled(true),
      setLabsLocalPairingEnabled(false),
    ]);
  });

  it('still toggles the dock and ignores other commands', () => {
    expect(runLabCommand('enable-experimental-dock')).toBe(true);
    expect(mocks.setDock).toHaveBeenCalledWith(true);
    expect(runLabCommand('new-workspace')).toBe(false);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
