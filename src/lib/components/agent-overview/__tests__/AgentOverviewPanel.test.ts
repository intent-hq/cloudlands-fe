import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { readable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphState } from '../types';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import {
  openWorkspaceFile,
  openWorkspaceNote,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import { loadGraphHistoryRequested } from '$store/renderer/slices/agent-overview/agent-overview-history-slice';
import { loadEventsRequested } from '$store/renderer/slices/workspace-events/workspace-events-slice';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  selectGraphState: vi.fn(),
  selectGraphStateAt: { select: vi.fn() },
  selectGraphHistoryStatus: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: {}, dispatch: mocks.dispatch });
});

vi.mock('$store/renderer/slices/agent-overview/agent-overview-selectors', () => ({
  selectGraphState: mocks.selectGraphState,
  selectGraphStateAt: mocks.selectGraphStateAt,
}));

vi.mock('$store/renderer/slices/agent-overview/agent-overview-history-selectors', () => ({
  selectGraphHistoryStatus: mocks.selectGraphHistoryStatus,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => ({
  default: (await import('../../chat/__tests__/mocks/MockAvatarWithState.svelte')).default,
}));

import AgentOverviewPanel from '../AgentOverviewPanel.svelte';

const timestamp = '2026-09-04T00:00:00.000Z';
const graph: GraphState = {
  nodes: [
    {
      id: 'agent:one',
      type: 'agent',
      agentId: 'one',
      name: 'Agent One',
      isCoordinator: true,
      status: 'idle',
      createdAt: timestamp,
      x: 100,
      y: 100,
      vx: 0,
      vy: 0,
    },
    {
      id: 'task:one',
      type: 'task',
      taskId: 'task-one',
      title: 'Task One',
      state: 'in_progress',
      dependsOn: [],
      x: 300,
      y: 100,
      vx: 0,
      vy: 0,
    },
    {
      id: 'file:one',
      type: 'file',
      path: 'src/one.ts',
      fileName: 'one.ts',
      isExternal: false,
      lastAction: 'read',
      lastActionTimestamp: timestamp,
      x: 100,
      y: 250,
      vx: 0,
      vy: 0,
    },
    {
      id: 'note:one',
      type: 'note',
      noteId: 'note-one',
      title: 'Note One',
      lastAction: 'read',
      lastActionTimestamp: timestamp,
      x: 300,
      y: 250,
      vx: 0,
      vy: 0,
    },
  ],
  edges: [
    {
      id: 'file-edge',
      type: 'file-read',
      sourceId: 'agent:one',
      targetId: 'file:one',
      agentId: 'one',
      filePath: 'src/one.ts',
      timestamp,
      isActive: false,
      count: 1,
    },
    {
      id: 'note-edge',
      type: 'note-read',
      sourceId: 'agent:one',
      targetId: 'note:one',
      agentId: 'one',
      noteId: 'note-one',
      timestamp,
      isActive: false,
      count: 1,
    },
  ],
  stats: {
    agents: { active: 1, total: 1 },
    tasks: {
      not_started: 0,
      waiting: 0,
      discussion_needed: 0,
      blocked: 0,
      in_progress: 1,
      review_required: 0,
      complete: 0,
      cancelled: 0,
    },
    files: 1,
    notes: 1,
  },
  currentTime: timestamp,
  isLive: true,
  minTime: timestamp,
  maxTime: timestamp,
};

function renderPanel(inputGraph = graph) {
  mocks.selectGraphState.mockReturnValue(readable(inputGraph));
  mocks.selectGraphHistoryStatus.mockReturnValue(readable('complete'));
  mocks.selectGraphStateAt.select.mockReturnValue({ ...inputGraph, isLive: false });
  const result = render(AgentOverviewPanel, { props: { workspaceId: 'workspace-one' } });
  result.container.firstElementChild?.setAttribute('data-panel-id', 'source-panel');
  return result;
}

beforeEach(() => {
  mocks.dispatch.mockClear();
  mocks.selectGraphStateAt.select.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AgentOverviewPanel', () => {
  it('renders graph stats and keeps layer toggles in component state', async () => {
    renderPanel();

    expect(screen.getByText('1 agent active · 1 task · 1 file')).toBeTruthy();
    expect(screen.getByText('Legend')).toBeTruthy();
    expect(screen.getByRole('button', { name: /one\.ts/ })).toBeTruthy();
    expect(mocks.dispatch).toHaveBeenCalledWith(loadEventsRequested('workspace-one'));
    expect(mocks.dispatch).toHaveBeenCalledWith(loadGraphHistoryRequested('workspace-one'));

    const filesToggle = screen.getByRole('button', { name: 'Files' });
    await fireEvent.click(filesToggle);

    expect(filesToggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('button', { name: /one\.ts/ })).toBeNull();
  });

  it('routes agent, task, note, and file open gestures through panel navigation actions', async () => {
    renderPanel();

    await fireEvent.dblClick(screen.getByRole('button', { name: /Agent One/ }), { ctrlKey: true });
    const taskButton = screen.getByRole('button', { name: /Task One/ });
    taskButton.focus();
    await fireEvent.keyDown(taskButton, { key: 'Enter' });
    await fireEvent.dblClick(screen.getByRole('button', { name: /Note One/ }));
    await fireEvent.dblClick(screen.getByRole('button', { name: /one\.ts/ }));

    expect(mocks.dispatch).toHaveBeenCalledWith(
      openAgentTabRequested('workspace-one', {
        agentId: 'one',
        sourcePanelId: 'source-panel',
        openInAdjacentPanel: true,
      }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      openWorkspaceNote('workspace-one', 'task-one', {
        sourcePanelId: 'source-panel',
        openInAdjacentPanel: false,
      }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      openWorkspaceNote('workspace-one', 'note-one', {
        sourcePanelId: 'source-panel',
        openInAdjacentPanel: false,
      }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      openWorkspaceFile('workspace-one', 'src/one.ts', {
        sourcePanelId: 'source-panel',
        openInAdjacentPanel: false,
      }),
    );
  });

  it('advances the historical graph cursor continuously during playback', async () => {
    const middle = '2026-09-04T01:00:00.000Z';
    const end = '2026-09-04T02:00:00.000Z';
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    renderPanel({ ...graph, maxTime: end, eventTimes: [timestamp, middle, end] });
    callbacks.length = 0;

    await fireEvent.click(screen.getByRole('button', { name: /play/i }));
    await tick();
    expect(mocks.selectGraphStateAt.select).toHaveBeenCalledOnce();

    const base = performance.now();
    for (const now of [base + 16, base + 32, base + 48]) {
      const frameCallbacks = callbacks.splice(0);
      frameCallbacks.forEach((callback) => callback(now));
      await tick();
    }
    expect(mocks.selectGraphStateAt.select.mock.calls.length).toBeGreaterThan(1);
    const lastCursor = mocks.selectGraphStateAt.select.mock.calls.at(-1)?.[2];
    expect(Date.parse(lastCursor)).toBeGreaterThan(Date.parse(timestamp));
    expect(Date.parse(lastCursor)).toBeLessThan(Date.parse(middle));
  });

  it('shows the graph history loading state near the scrubber', () => {
    mocks.selectGraphHistoryStatus.mockReturnValue(readable('loading'));
    mocks.selectGraphState.mockReturnValue(readable(graph));
    mocks.selectGraphStateAt.select.mockReturnValue({ ...graph, isLive: false });

    render(AgentOverviewPanel, { props: { workspaceId: 'workspace-one' } });

    expect(screen.getByText('Loading history…')).toBeTruthy();
  });
});
