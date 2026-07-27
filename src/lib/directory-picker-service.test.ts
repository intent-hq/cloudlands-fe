import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasCapability: vi.fn(),
  isDaemonLocal: vi.fn(),
  openDirectory: vi.fn(),
}));

vi.mock('$lib/electron-bridge', () => ({
  dialog: { openDirectory: mocks.openDirectory },
}));
vi.mock('$lib/utils/platform-capabilities', () => ({
  hasCapability: mocks.hasCapability,
}));
vi.mock('$store/renderer/slices/daemon-health/daemon-health-selectors', () => ({
  selectIsDaemonLocal: { select: mocks.isDaemonLocal },
}));
vi.mock('$store/renderer/store', () => ({
  store: { state: {} },
}));

import { pickDirectory } from './directory-picker-service';

describe('pickDirectory', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses the native picker and selects its path for a local Electron daemon', async () => {
    mocks.hasCapability.mockReturnValue(true);
    mocks.isDaemonLocal.mockReturnValue(true);
    mocks.openDirectory.mockResolvedValue('/Users/me/project');
    const openModal = vi.fn();
    const onSelect = vi.fn();

    await pickDirectory({
      title: 'Select Repository Folder',
      defaultPath: '/Users/me',
      openModal,
      onSelect,
    });

    expect(mocks.openDirectory).toHaveBeenCalledExactlyOnceWith({
      title: 'Select Repository Folder',
      defaultPath: '/Users/me',
    });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('/Users/me/project');
    expect(openModal).not.toHaveBeenCalled();
  });

  it('opens the modal without invoking native IPC for a remote daemon', async () => {
    mocks.hasCapability.mockReturnValue(true);
    mocks.isDaemonLocal.mockReturnValue(false);
    const openModal = vi.fn();
    const onSelect = vi.fn();

    await pickDirectory({ openModal, onSelect });

    expect(openModal).toHaveBeenCalledOnce();
    expect(mocks.openDirectory).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('opens the modal when native dialogs are unavailable', async () => {
    mocks.hasCapability.mockReturnValue(false);
    const openModal = vi.fn();

    await pickDirectory({ openModal, onSelect: vi.fn() });

    expect(openModal).toHaveBeenCalledOnce();
    expect(mocks.isDaemonLocal).not.toHaveBeenCalled();
    expect(mocks.openDirectory).not.toHaveBeenCalled();
  });

  it('leaves the current selection unchanged when the native picker is cancelled', async () => {
    mocks.hasCapability.mockReturnValue(true);
    mocks.isDaemonLocal.mockReturnValue(true);
    mocks.openDirectory.mockResolvedValue(null);
    const openModal = vi.fn();
    const onSelect = vi.fn();

    await pickDirectory({ openModal, onSelect });

    expect(onSelect).not.toHaveBeenCalled();
    expect(openModal).not.toHaveBeenCalled();
  });
});
