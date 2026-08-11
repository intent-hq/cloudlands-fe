import { describe, expect, it } from 'vitest';
import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import { resolveTerminalShortcutWorkspaceId } from './terminal-shortcut-context';

describe('resolveTerminalShortcutWorkspaceId', () => {
  it('targets the selected workspace instead of the route in column mode', () => {
    expect(
      resolveTerminalShortcutWorkspaceId({
        isOnWorkspacePage: true,
        useSelectedWorkspace: true,
        selectedWorkspaceId: 'morning-penguin',
        routeWorkspaceId: 'amber-forest',
      }),
    ).toBe('morning-penguin');
  });

  it('keeps route ownership in single-workspace mode', () => {
    expect(
      resolveTerminalShortcutWorkspaceId({
        isOnWorkspacePage: true,
        useSelectedWorkspace: false,
        selectedWorkspaceId: 'morning-penguin',
        routeWorkspaceId: 'amber-forest',
      }),
    ).toBe('amber-forest');
  });

  it('falls back to the route while column selection is unavailable', () => {
    expect(
      resolveTerminalShortcutWorkspaceId({
        isOnWorkspacePage: true,
        useSelectedWorkspace: true,
        selectedWorkspaceId: null,
        routeWorkspaceId: 'amber-forest',
      }),
    ).toBe('amber-forest');
  });

  it('uses root terminal ownership outside real workspaces', () => {
    expect(
      resolveTerminalShortcutWorkspaceId({
        isOnWorkspacePage: false,
        useSelectedWorkspace: false,
        selectedWorkspaceId: null,
        routeWorkspaceId: undefined,
      }),
    ).toBe(ROOT_WORKSPACE_ID);
  });
});
