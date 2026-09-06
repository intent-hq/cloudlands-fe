import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createMockSelector, mapState } = vi.hoisted(() => {
  const readable = (getter: () => unknown) => ({
    subscribe(listener: (value: unknown) => void) {
      listener(getter());
      return () => {};
    },
  });
  const createMockSelector = (getter: () => unknown) => {
    const selector = Object.assign(() => readable(getter), {
      select: getter,
      effect: () => undefined,
    });
    return selector;
  };
  const mapState = { current: {} as Record<string, unknown> };
  return { createMockSelector, mapState };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule();
});
vi.mock('$store/renderer/slices/semantic-map/semantic-map-selectors', () => ({
  selectSemanticMapState: createMockSelector(() => mapState.current),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: createMockSelector(() => []),
}));
vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTaskDisplayList: createMockSelector(() => []),
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
      route: null,
      selectedAgentId: null,
      selectedTaskNoteId: null,
      selectedRegionId: null,
      timeWindow: { startTs: null, endTs: null },
      kindFilter: [],
      agentFilter: [],
    };
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
});
