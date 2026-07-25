/**
 * @vitest-environment jsdom
 *
 * Unit tests for the effective isolated-checkout mode resolver: `cow` only
 * when the BE-owned `workspace.cowIsolation` setting (PROTOCOL §5.12) is on
 * AND a loaded workspace carries `cowSupported: true` (a machine capability);
 * `worktree` otherwise, including on wire failure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSettingsGet } = vi.hoisted(() => ({
  mockSettingsGet: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: { get: mockSettingsGet },
  },
}));

const { mockStoreState, mockSelectItems } = vi.hoisted(() => ({
  mockStoreState: { workspace: { workspaces: { ids: [], entities: {} } } },
  mockSelectItems: vi.fn(() => [] as Array<{ cowSupported?: boolean }>),
}));

vi.mock('$store/renderer/store', () => ({
  store: {
    get state() {
      return mockStoreState;
    },
  },
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: { select: mockSelectItems },
}));

import { isolationNoun, resolveEffectiveIsolationMode } from '../isolation-mode';

describe('isolationNoun', () => {
  it('maps modes to human copy', () => {
    expect(isolationNoun('cow')).toBe('CoW checkout');
    expect(isolationNoun('worktree')).toBe('worktree');
  });
});

describe('resolveEffectiveIsolationMode', () => {
  beforeEach(() => {
    mockSettingsGet.mockReset();
    mockSelectItems.mockReset();
    mockSelectItems.mockReturnValue([]);
  });

  it('asks the daemon for workspace.cowIsolation (§5.9 settings.get envelope)', async () => {
    mockSettingsGet.mockResolvedValue({ path: 'workspace.cowIsolation', value: false });
    await resolveEffectiveIsolationMode();
    expect(mockSettingsGet).toHaveBeenCalledWith('workspace.cowIsolation');
  });

  it('setting off → worktree, without consulting workspace items', async () => {
    mockSettingsGet.mockResolvedValue({ path: 'workspace.cowIsolation', value: false });
    await expect(resolveEffectiveIsolationMode()).resolves.toBe('worktree');
    expect(mockSelectItems).not.toHaveBeenCalled();
  });

  it('setting on + a workspace with cowSupported: true → cow', async () => {
    mockSettingsGet.mockResolvedValue({ path: 'workspace.cowIsolation', value: true });
    mockSelectItems.mockReturnValue([{ cowSupported: undefined }, { cowSupported: true }]);
    await expect(resolveEffectiveIsolationMode()).resolves.toBe('cow');
  });

  it('setting on but no cow-supported workspaces loaded → worktree', async () => {
    mockSettingsGet.mockResolvedValue({ path: 'workspace.cowIsolation', value: true });
    mockSelectItems.mockReturnValue([{ cowSupported: false }, {}]);
    await expect(resolveEffectiveIsolationMode()).resolves.toBe('worktree');
  });

  it('setting on with zero workspaces loaded → worktree (capability unknown)', async () => {
    mockSettingsGet.mockResolvedValue({ path: 'workspace.cowIsolation', value: true });
    mockSelectItems.mockReturnValue([]);
    await expect(resolveEffectiveIsolationMode()).resolves.toBe('worktree');
  });

  it('uses caller-provided workspaces over the store snapshot', async () => {
    mockSettingsGet.mockResolvedValue({ path: 'workspace.cowIsolation', value: true });
    mockSelectItems.mockReturnValue([]);
    await expect(resolveEffectiveIsolationMode([{ cowSupported: true }])).resolves.toBe('cow');
    expect(mockSelectItems).not.toHaveBeenCalled();
  });

  it('settings.get failure → worktree', async () => {
    mockSettingsGet.mockRejectedValue(new Error('wire down'));
    await expect(resolveEffectiveIsolationMode()).resolves.toBe('worktree');
  });
});
