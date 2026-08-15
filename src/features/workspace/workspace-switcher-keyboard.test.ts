import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { gotoMock } = vi.hoisted(() => ({
  gotoMock: vi.fn(),
}));

vi.mock('$app/navigation', () => ({
  goto: gotoMock,
}));

import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { writable } from 'svelte/store';
import {
  loadRecencyData,
  openWorkspaceRequested,
  replaceWorkspaceList,
  resetWorkspaceState,
} from '$store/renderer/slices/workspace/workspace-slice';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import {
  selectSelectedWorkspaceId,
  selectSwitcherState,
  selectSwitcherWorkspaceIds,
} from '$store/renderer/slices/workspace-switcher/workspace-switcher-selectors';
import { store as appStore } from '$store/renderer/store';
import {
  attachWorkspaceSwitcherKeyboard,
  buildSwitcherWorkspaceIds,
  handleSwitcherKeydown as handleSwitcherKeydownWithWorkspace,
  handleSwitcherKeyup as handleSwitcherKeyupWithWorkspace,
} from './workspace-switcher-keyboard';

let selectedWorkspaceContextId: string | null = null;

function selectedWorkspaceId(): string | null {
  return selectedWorkspaceContextId;
}

function handleSwitcherKeydown(event: KeyboardEvent): void {
  handleSwitcherKeydownWithWorkspace(event, selectedWorkspaceId());
}

function handleSwitcherKeyup(event: KeyboardEvent): void {
  handleSwitcherKeyupWithWorkspace(event, selectedWorkspaceId());
}

function makeWorkspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    title: 'Test Workspace',
    path: `/tmp/${overrides.id}`,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    status: WorkspaceStatusEnum.Active,
    ...overrides,
    id: overrides.id as WorkspaceId,
  };
}

function makeKeyboardEvent(
  overrides: Partial<Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey'>> = {},
): KeyboardEvent {
  return {
    key: 'Tab',
    ctrlKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

/**
 * Seed the real store: three active workspaces (plus one archived), ws-2
 * active, recency ws-3 > ws-1. Recency-ordered actives: ws-3, ws-1 (+ active
 * ws-2), so the switcher order is [ws-2, ws-3, ws-1] with index 1 selected.
 */
function seedWorkspaces({
  workspaces = [
    makeWorkspace({ id: 'ws-1' }),
    makeWorkspace({ id: 'ws-2' }),
    makeWorkspace({ id: 'ws-3' }),
    makeWorkspace({ id: 'ws-archived', status: WorkspaceStatusEnum.Archived }),
  ],
  currentWorkspaceId = 'ws-2',
  lastViewedAt = { 'ws-3': 30, 'ws-2': 20, 'ws-1': 10 },
}: {
  workspaces?: Workspace[];
  currentWorkspaceId?: string | null;
  lastViewedAt?: Record<string, number>;
} = {}): void {
  selectedWorkspaceContextId = currentWorkspaceId;
  appStore.dispatch(replaceWorkspaceList(workspaces));
  if (currentWorkspaceId) {
    appStore.dispatch(openWorkspaceTab(currentWorkspaceId));
  }
  appStore.dispatch(loadRecencyData({ lastViewedAt }));
}

function openSwitcherViaCtrlTab(): void {
  handleSwitcherKeydown(makeKeyboardEvent({ key: 'Tab', ctrlKey: true }));
}

function switcherState() {
  return selectSwitcherState.select(appStore.state);
}

function switcherIds() {
  return selectSwitcherWorkspaceIds.select(appStore.state, selectedWorkspaceId());
}

beforeAll(() => {
  appStore.init();
});

beforeEach(() => {
  selectedWorkspaceContextId = null;
  appStore.dispatch(resetWorkspaceState());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildSwitcherWorkspaceIds', () => {
  it('builds switcher ids with the current workspace first', () => {
    const workspaces = [
      makeWorkspace({ id: 'ws-1' }),
      makeWorkspace({ id: 'ws-2' }),
      makeWorkspace({ id: 'ws-3' }),
    ];

    expect(buildSwitcherWorkspaceIds(workspaces, 'ws-2')).toEqual(['ws-2', 'ws-1', 'ws-3']);
  });

  it('returns an empty list when there are no other workspaces', () => {
    expect(buildSwitcherWorkspaceIds([makeWorkspace({ id: 'ws-2' })], 'ws-2')).toEqual([]);
    expect(buildSwitcherWorkspaceIds([], null)).toEqual([]);
  });

  it('omits the active slot when the active workspace is not in the list', () => {
    const workspaces = [makeWorkspace({ id: 'ws-1' }), makeWorkspace({ id: 'ws-3' })];

    expect(buildSwitcherWorkspaceIds(workspaces, 'ws-2')).toEqual(['ws-1', 'ws-3']);
  });
});

describe('handleSwitcherKeydown — Ctrl+Tab', () => {
  it('opens the switcher from active, non-archived workspaces sorted by recency', () => {
    seedWorkspaces();
    const event = makeKeyboardEvent({ key: 'Tab', ctrlKey: true });

    handleSwitcherKeydown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(switcherIds()).toEqual(['ws-2', 'ws-3', 'ws-1']);
    expect(switcherState()).toEqual({ selectedIndex: 1, selectionHandled: false });
    expect(selectSelectedWorkspaceId.select(appStore.state, selectedWorkspaceId())).toBe('ws-3');
  });

  it('does not open when there are no other workspaces', () => {
    seedWorkspaces({
      workspaces: [makeWorkspace({ id: 'ws-1' })],
      currentWorkspaceId: 'ws-1',
      lastViewedAt: { 'ws-1': 10 },
    });
    const event = makeKeyboardEvent({ key: 'Tab', ctrlKey: true });

    handleSwitcherKeydown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(switcherState().selectionHandled).toBe(true);
    expect(switcherIds()).toEqual([]);
  });

  it('does not open when the only other workspaces are archived', () => {
    seedWorkspaces({
      workspaces: [
        makeWorkspace({ id: 'ws-1' }),
        makeWorkspace({ id: 'ws-archived', status: WorkspaceStatusEnum.Archived }),
      ],
      currentWorkspaceId: 'ws-1',
      lastViewedAt: { 'ws-1': 10 },
    });

    openSwitcherViaCtrlTab();

    expect(switcherState().selectionHandled).toBe(true);
  });

  it('cycles forward on repeat Ctrl+Tab and backward with Shift held', () => {
    seedWorkspaces();
    openSwitcherViaCtrlTab();
    expect(switcherState().selectedIndex).toBe(1);

    handleSwitcherKeydown(makeKeyboardEvent({ key: 'Tab', ctrlKey: true }));
    expect(switcherState().selectedIndex).toBe(2);

    handleSwitcherKeydown(makeKeyboardEvent({ key: 'Tab', ctrlKey: true, shiftKey: true }));
    expect(switcherState().selectedIndex).toBe(1);
  });
});

describe('handleSwitcherKeydown — while open', () => {
  beforeEach(() => {
    seedWorkspaces();
    openSwitcherViaCtrlTab();
  });

  it('closes without navigating on Escape', () => {
    const event = makeKeyboardEvent({ key: 'Escape' });

    handleSwitcherKeydown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(switcherState().selectionHandled).toBe(true);
    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('cycles forward on ArrowDown and j', () => {
    handleSwitcherKeydown(makeKeyboardEvent({ key: 'ArrowDown' }));
    expect(switcherState().selectedIndex).toBe(2);

    handleSwitcherKeydown(makeKeyboardEvent({ key: 'j' }));
    expect(switcherState().selectedIndex).toBe(0);
  });

  it('cycles backward on ArrowUp and k', () => {
    handleSwitcherKeydown(makeKeyboardEvent({ key: 'ArrowUp' }));
    expect(switcherState().selectedIndex).toBe(0);

    handleSwitcherKeydown(makeKeyboardEvent({ key: 'k' }));
    expect(switcherState().selectedIndex).toBe(2);
  });

  it('jumps to the first entry on Home and the last entry on End', () => {
    const homeEvent = makeKeyboardEvent({ key: 'Home' });
    handleSwitcherKeydown(homeEvent);
    expect(homeEvent.preventDefault).toHaveBeenCalled();
    expect(switcherState().selectedIndex).toBe(0);

    const endEvent = makeKeyboardEvent({ key: 'End' });
    handleSwitcherKeydown(endEvent);
    expect(endEvent.preventDefault).toHaveBeenCalled();
    expect(switcherState().selectedIndex).toBe(2);
  });

  it('does not preventDefault Home/End when already at the boundary', () => {
    handleSwitcherKeydown(makeKeyboardEvent({ key: 'Home' }));

    const homeEvent = makeKeyboardEvent({ key: 'Home' });
    handleSwitcherKeydown(homeEvent);
    expect(homeEvent.preventDefault).not.toHaveBeenCalled();
    expect(switcherState().selectedIndex).toBe(0);

    handleSwitcherKeydown(makeKeyboardEvent({ key: 'End' }));
    const endEvent = makeKeyboardEvent({ key: 'End' });
    handleSwitcherKeydown(endEvent);
    expect(endEvent.preventDefault).not.toHaveBeenCalled();
    expect(switcherState().selectedIndex).toBe(2);
  });

  it('confirms the selection and navigates on Enter', () => {
    const dispatchSpy = vi.spyOn(appStore, 'dispatch');
    const event = makeKeyboardEvent({ key: 'Enter' });

    handleSwitcherKeydown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(switcherState().selectionHandled).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith(openWorkspaceRequested('ws-3'));
    expect(gotoMock).toHaveBeenCalledWith('/workspace/ws-3');
    dispatchSpy.mockRestore();
  });

  it('does not navigate when the selection is the active workspace', () => {
    handleSwitcherKeydown(makeKeyboardEvent({ key: 'ArrowUp' }));
    expect(selectSelectedWorkspaceId.select(appStore.state, selectedWorkspaceId())).toBe('ws-2');

    const dispatchSpy = vi.spyOn(appStore, 'dispatch');
    handleSwitcherKeydown(makeKeyboardEvent({ key: 'Enter' }));

    expect(switcherState().selectionHandled).toBe(true);
    expect(dispatchSpy).not.toHaveBeenCalledWith(openWorkspaceRequested('ws-2'));
    expect(gotoMock).not.toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });
});

describe('handleSwitcherKeydown — while closed', () => {
  it('ignores non-Ctrl+Tab keys when the switcher is closed', () => {
    seedWorkspaces();

    for (const key of ['Escape', 'ArrowDown', 'ArrowUp', 'j', 'k', 'Enter', 'Home', 'End']) {
      const event = makeKeyboardEvent({ key });
      handleSwitcherKeydown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }

    expect(switcherState().selectionHandled).toBe(true);
    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('ignores plain Tab without Ctrl', () => {
    seedWorkspaces();
    const event = makeKeyboardEvent({ key: 'Tab' });

    handleSwitcherKeydown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(switcherState().selectionHandled).toBe(true);
  });
});

describe('handleSwitcherKeyup', () => {
  it.each(['Control', 'Meta'])('confirms and navigates when %s is released', (key) => {
    seedWorkspaces();
    openSwitcherViaCtrlTab();
    const event = makeKeyboardEvent({ key });

    handleSwitcherKeyup(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(switcherState().selectionHandled).toBe(true);
    expect(gotoMock).toHaveBeenCalledWith('/workspace/ws-3');
  });

  it('ignores modifier release while the switcher is closed', () => {
    seedWorkspaces();
    const event = makeKeyboardEvent({ key: 'Control' });

    handleSwitcherKeyup(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('ignores non-modifier keyups while the switcher is open', () => {
    seedWorkspaces();
    openSwitcherViaCtrlTab();
    const event = makeKeyboardEvent({ key: 'Shift' });

    handleSwitcherKeyup(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(switcherState().selectionHandled).toBe(false);
  });
});

describe('attachWorkspaceSwitcherKeyboard', () => {
  it('drives the switcher from real window events and detaches on cleanup', () => {
    seedWorkspaces();
    const cleanup = attachWorkspaceSwitcherKeyboard(writable(selectedWorkspaceId()));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true }));
    expect(switcherState()).toEqual({ selectedIndex: 1, selectionHandled: false });

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
    expect(switcherState().selectionHandled).toBe(true);
    expect(gotoMock).toHaveBeenCalledWith('/workspace/ws-3');

    cleanup();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true }));
    expect(switcherState().selectionHandled).toBe(true);
  });
});
