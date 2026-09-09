import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createMockSelector, dispatchMock, emitSelectors, mapState, taskProgress } = vi.hoisted(
  () => {
    const listeners = new Set<() => void>();
    const readable = (getter: () => unknown) => ({
      subscribe(listener: (value: unknown) => void) {
        listener(getter());
        const notify = () => listener(getter());
        listeners.add(notify);
        return () => listeners.delete(notify);
      },
    });
    const createMockSelector = (getter: () => unknown) => {
      const selector = Object.assign(() => readable(getter), {
        select: getter,
        effect: () => undefined,
      });
      return selector;
    };
    const dispatchMock = vi.fn();
    const emitSelectors = () => listeners.forEach((listener) => listener());
    const mapState = { current: {} as Record<string, unknown> };
    const taskProgress = { current: { total: 0, completed: 0, inProgress: 0 } };
    return { createMockSelector, dispatchMock, emitSelectors, mapState, taskProgress };
  },
);

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch: dispatchMock });
});
vi.mock('$store/renderer/slices/semantic-map/semantic-map-selectors', () => ({
  selectSemanticMapState: createMockSelector(() => mapState.current),
  selectFilteredSemanticMapActivities: createMockSelector(
    () => mapState.current.filteredActivities ?? mapState.current.activities,
  ),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: createMockSelector(() => []),
}));
vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTaskDisplayList: createMockSelector(() => []),
  selectWorkspaceTaskProgress: createMockSelector(() => taskProgress.current),
}));
vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectFileTrackingChanges: createMockSelector(() => []),
}));
vi.mock('$lib/components/visualization/semantic-map/SemanticMapCanvas.svelte', async () => ({
  default: (await import('./__tests__/mocks/SemanticMapCanvasMock.svelte')).default,
}));
vi.mock('$lib/components/visualization/semantic-map/SemanticMapDetail.svelte', async () => ({
  default: (await import('./__tests__/mocks/SemanticMapDetailMock.svelte')).default,
}));

import { SEMANTIC_MAP_FIXTURE_MANIFEST } from '$lib/components/visualization/semantic-map/core/fixtures';
import { m } from '$shared/paraglide/messages.js';
import MapTabType from './MapTabType.svelte';

const tab = { id: 'map', type: 'map' as const, title: 'Map', closable: true };

function renderMapTab() {
  return render(MapTabType, {
    props: {
      tab,
      workspaceId: 'ws-1',
      isActive: true,
      isPanelFocused: true,
    },
  });
}

describe('MapTabType hydration states', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    mapState.current = {
      hydrationStatus: 'idle',
      manifest: null,
      source: null,
      activities: [],
      filteredActivities: [],
      route: null,
      agentRoutes: {},
      selectedAgentIds: [],
      selectedTaskNoteId: null,
      selectedRegionId: null,
      timeWindow: { startTs: null, endTs: null },
      kindFilter: [],
      agentFilter: [],
    };
    taskProgress.current = { total: 0, completed: 0, inProgress: 0 };
    dispatchMock.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders accessible loading and error feedback', () => {
    mapState.current.hydrationStatus = 'loading';
    const result = renderMapTab();
    expect(
      screen.getByText(m.semanticMap_panel_loading_description()).closest('[role="status"]'),
    ).not.toBeNull();

    result.unmount();
    mapState.current.hydrationStatus = 'error';
    renderMapTab();
    expect(screen.getByRole('alert').textContent).toContain(
      m.semanticMap_panel_error_description(),
    );
  });

  it('labels a structural fallback distinctly from an empty selection', () => {
    mapState.current = {
      ...mapState.current,
      hydrationStatus: 'loaded',
      manifest: SEMANTIC_MAP_FIXTURE_MANIFEST,
      source: 'structural',
    };
    renderMapTab();

    const hint = screen.getByTestId('semantic-map-source-hint');
    expect(hint.getAttribute('data-map-source')).toBe('structural');
    expect(hint.textContent).toContain(m.semanticMap_panel_structuralHint_description());
    expect(hint.textContent).not.toContain(m.semanticMap_canvas_selectionNone_description());
  });

  it('renders canonical task progress from the task store', () => {
    taskProgress.current = { total: 5, completed: 2, inProgress: 1 };
    renderMapTab();

    expect(
      screen.getByRole('heading', {
        name: m.workspace_flameGraph_tasksComplete_label({ completed: '2', total: '5' }),
      }),
    ).toBeTruthy();
  });

  it('passes default live activity to the canvas and dispatches accessible filters', async () => {
    const activities = [
      {
        id: 'activity-a',
        agentId: 'a',
        agentName: 'Ada',
        regionId: 'renderer-ui',
        kind: 'read',
        ts: '2026-09-07T05:00:00.000Z',
      },
      {
        id: 'activity-b',
        agentId: 'b',
        agentName: 'Bob',
        regionId: 'renderer-ui',
        kind: 'edit',
        ts: '2026-09-07T05:00:01.000Z',
      },
    ];
    mapState.current = {
      ...mapState.current,
      hydrationStatus: 'loaded',
      manifest: SEMANTIC_MAP_FIXTURE_MANIFEST,
      source: 'curated',
      activities,
      filteredActivities: activities,
    };
    renderMapTab();

    const canvas = screen.getByTestId('semantic-map-canvas');
    expect(canvas.getAttribute('data-activity-count')).toBe('2');
    expect(canvas.getAttribute('data-agent-filter')).toBe('');
    expect(canvas.getAttribute('data-kind-filter')).toBe('');

    await fireEvent.click(screen.getAllByRole('button', { name: 'Ada' })[0]);
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'semanticMap/agentFilterChanged',
      payload: ['ws-1', ['b']],
    });

    await fireEvent.click(screen.getByRole('button', { name: m.semanticMap_sandbox_read_label() }));
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'semanticMap/kindFilterChanged',
      payload: ['ws-1', ['edit', 'create', 'delete', 'move', 'tool', 'thinking']],
    });

    await fireEvent.click(
      screen.getByRole('button', {
        name: m.semanticMap_sandbox_minutes_label({ count: '15' }),
      }),
    );
    expect(dispatchMock.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'semanticMap/timeWindowChanged',
      payload: ['ws-1', { endTs: null }],
    });
    const startTs = dispatchMock.mock.calls.at(-1)?.[0].payload[1].startTs;
    expect(Date.now() - Date.parse(startTs)).toBeGreaterThanOrEqual(14.9 * 60_000);
    expect(Date.now() - Date.parse(startTs)).toBeLessThanOrEqual(15.1 * 60_000);
  });

  it('keeps the map visible while explaining empty and filtered activity states', () => {
    mapState.current = {
      ...mapState.current,
      hydrationStatus: 'loaded',
      manifest: SEMANTIC_MAP_FIXTURE_MANIFEST,
      source: 'curated',
    };
    const result = renderMapTab();

    expect(screen.getByTestId('semantic-map-canvas')).not.toBeNull();
    expect(screen.getByTestId('semantic-map-empty-state').textContent).toContain(
      m.semanticMap_panel_noActivity_description(),
    );

    result.unmount();
    mapState.current = {
      ...mapState.current,
      activities: [
        {
          id: 'activity-a',
          agentId: 'a',
          regionId: 'renderer-ui',
          kind: 'read',
          ts: '2026-09-07T05:00:00.000Z',
        },
      ],
      filteredActivities: [],
      agentFilter: ['b'],
    };
    renderMapTab();
    expect(screen.getByTestId('semantic-map-empty-state').textContent).toContain(
      m.semanticMap_panel_noMatchingActivity_description(),
    );
  });

  it('exposes keyboard-native compact sidebar disclosures', async () => {
    mapState.current = {
      ...mapState.current,
      hydrationStatus: 'loaded',
      manifest: SEMANTIC_MAP_FIXTURE_MANIFEST,
      source: 'curated',
    };
    renderMapTab();

    const filters = screen.getByRole('button', { name: m.semanticMap_panel_filters_label() });
    const details = screen.getByRole('button', { name: m.semanticMap_panel_details_label() });
    expect(filters.getAttribute('aria-expanded')).toBe('false');
    expect(details.getAttribute('aria-expanded')).toBe('false');

    await fireEvent.click(filters);
    await fireEvent.click(details);
    expect(filters.getAttribute('aria-expanded')).toBe('true');
    expect(details.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps crossing detail bound to its regions when route order changes', async () => {
    mapState.current = {
      ...mapState.current,
      hydrationStatus: 'loaded',
      manifest: SEMANTIC_MAP_FIXTURE_MANIFEST,
      source: 'curated',
      selectedAgentIds: ['a'],
      agentRoutes: {
        a: {
          visits: ['one', 'two', 'three'],
          transitions: [
            { from: 'one', to: 'two', count: 1, evidence: [] },
            { from: 'two', to: 'three', count: 1, evidence: [] },
          ],
        },
      },
    };
    renderMapTab();
    const detail = screen.getByTestId('semantic-map-detail');
    await fireEvent.click(detail);
    expect(detail.getAttribute('data-transition-index')).toBe('0');

    mapState.current.agentRoutes = {
      a: {
        visits: ['one', 'two', 'three'],
        transitions: [
          { from: 'two', to: 'three', count: 2, evidence: [] },
          { from: 'one', to: 'two', count: 2, evidence: [] },
        ],
      },
    };
    emitSelectors();

    await vi.waitFor(() => expect(detail.getAttribute('data-transition-index')).toBe('1'));
  });
});
