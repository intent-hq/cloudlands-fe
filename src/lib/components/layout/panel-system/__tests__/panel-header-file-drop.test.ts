/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelState, PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { panelLayout: { byWorkspaceId: {} } },
}));
const readable = <T>(value: T) => ({
  subscribe(run: (current: T) => void) {
    run(value);
    return () => {};
  },
});

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch, state: mocks.state },
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectIsDragging: () => readable(false),
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-slice', () => ({
  startDrag: () => ({ type: 'tabState/startDrag' }),
  endDrag: () => ({ type: 'tabState/endDrag' }),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectPanelLayoutWorkspace: { select: () => null },
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: { select: () => null },
}));
vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  filterSpecialistsByGitHubAuth: (specialists: unknown[]) => specialists,
  filterPickableSpecialists: (specialists: unknown[]) => specialists,
  selectSpecialistName: { select: () => null },
  selectSpecialists: () => readable([]),
}));
vi.mock('$store/renderer/slices/daemon-health/daemon-health-selectors', () => ({
  selectIsDaemonLocal: () => readable(true),
}));
vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: () => readable(false),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: { select: () => null },
  selectIsWorkspaceHostLocal: () => readable(true),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: () => readable([]),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsResponding: { select: () => false },
  selectAgentIsWaiting: { select: () => false },
  selectAgentSession: () => readable(null),
}));
vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPermissionRequests: () => readable([]),
}));
vi.mock('$lib/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('$features/agent/components/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockAugieAvatar.svelte'))
    .default,
}));
vi.mock('$features/agent/components/auggie-avatar/AugieAvatarWithState.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockAugieAvatar.svelte'))
    .default,
}));
vi.mock('../PanelEmptyState.svelte', async () => ({
  default: (await import('$lib/components/workspace/__tests__/mocks/MockAugieAvatar.svelte'))
    .default,
}));
vi.mock('../PanelContentRenderer.svelte', async () => ({
  default: (await import('./mocks/FileDropRegisteringContent.svelte')).default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import Panel from '../Panel.svelte';
import {
  droppedFiles,
  dragChanges,
  resetFileDropSpies,
} from './mocks/FileDropRegisteringContent.svelte';

const TAB_DRAG_MIME = 'application/x-panel-tab';

class TestDataTransfer {
  effectAllowed = 'none';
  dropEffect = 'none';
  files: File[] = [];
  private readonly data = new Map<string, string>();

  get types() {
    const types = [...this.data.keys()];
    return this.files.length > 0 ? ['Files', ...types] : types;
  }

  setData(type: string, value: string) {
    this.data.set(type, value);
  }

  getData(type: string) {
    return this.data.get(type) ?? '';
  }
}

function fileDragData(): TestDataTransfer {
  const dataTransfer = new TestDataTransfer();
  dataTransfer.files = [new File(['content'], 'image.png', { type: 'image/png' })];
  return dataTransfer;
}

function tab(type: PanelTab['type']): PanelTab {
  return { id: 'tab-1', type, title: 'tab-1', closable: true };
}

function panel(tabType: PanelTab['type']): PanelState {
  return { id: 'panel-1', tabs: [tab(tabType)], activeTabId: 'tab-1' };
}

function dragEvent(type: string, dataTransfer: TestDataTransfer) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
}

function renderHeader(tabType: PanelTab['type']) {
  const { container } = render(Panel, {
    props: { panel: panel(tabType), workspaceId: 'workspace-1', layoutId: 'workspace-1' },
  });
  return container.querySelector<HTMLElement>('[data-panel-header]')!;
}

beforeEach(() => {
  resetFileDropSpies();
});

afterEach(() => {
  cleanup();
});

describe('panel header file drop', () => {
  it('routes a header file drop into the active agent tab handler and toggles the overlay signal', async () => {
    const header = renderHeader('agent');
    const dataTransfer = fileDragData();

    const enter = dragEvent('dragenter', dataTransfer);
    await fireEvent(header, enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(dragChanges).toEqual([true]);

    const over = dragEvent('dragover', dataTransfer);
    await fireEvent(header, over);
    expect(over.defaultPrevented).toBe(true);

    const drop = dragEvent('drop', dataTransfer);
    await fireEvent(header, drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(droppedFiles).toHaveLength(1);
    expect(droppedFiles[0].map((file) => file.name)).toEqual(['image.png']);
    expect(dragChanges).toEqual([true, false]);
  });

  it('clears the overlay signal when the drag leaves the header without dropping', async () => {
    const header = renderHeader('agent');
    const dataTransfer = fileDragData();

    await fireEvent(header, dragEvent('dragenter', dataTransfer));
    await fireEvent(header, dragEvent('dragleave', dataTransfer));

    expect(dragChanges).toEqual([true, false]);
    expect(droppedFiles).toHaveLength(0);
  });

  it('ignores non-file drags (tab drag MIME) on the header', async () => {
    const header = renderHeader('agent');
    const dataTransfer = new TestDataTransfer();
    dataTransfer.setData(TAB_DRAG_MIME, JSON.stringify({ tabId: 'x', panelId: 'other' }));

    const enter = dragEvent('dragenter', dataTransfer);
    await fireEvent(header, enter);
    await fireEvent(header, dragEvent('drop', dataTransfer));

    expect(enter.defaultPrevented).toBe(false);
    expect(dragChanges).toEqual([]);
    expect(droppedFiles).toHaveLength(0);
  });

  it('ignores header file drops when the active tab has no registered handler (non-agent tab)', async () => {
    const header = renderHeader('file');
    const dataTransfer = fileDragData();

    const enter = dragEvent('dragenter', dataTransfer);
    await fireEvent(header, enter);
    await fireEvent(header, dragEvent('drop', dataTransfer));

    expect(enter.defaultPrevented).toBe(false);
    expect(dragChanges).toEqual([]);
    expect(droppedFiles).toHaveLength(0);
  });
});
