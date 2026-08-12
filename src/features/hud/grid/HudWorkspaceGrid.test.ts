/**
 * HudWorkspaceGrid read gating — the grid renders one card per registered
 * workspace, but only cards the user can see may ask the daemon for their
 * `tasks` + `tokenUsage` rollups. Off-viewport cards issue nothing; scrolling
 * one into view issues exactly one read pair for it, and only for it. The
 * active workspace is exempt (its rollups back the rest of the UI).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { flushSync } from 'svelte';

import { store as appStore } from '$store/renderer/store';
import {
  resetWorkspaceState,
  setActiveWorkspaceId,
  setWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { hudActivated } from '$store/renderer/slices/hud/hud-slice';
import { ensureWorkspaceTasksLoaded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import { fetchWorkspaceTokenUsage } from '$store/renderer/slices/token-usage/token-usage-slice';
import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';

import HudWorkspaceGrid from './HudWorkspaceGrid.svelte';

const TASKS_READ = ensureWorkspaceTasksLoaded('probe').type;
const TOKENS_READ = fetchWorkspaceTokenUsage('probe').type;

/** Captured IntersectionObserver instances so tests can fire intersections. */
const observers: Array<{
  callback: IntersectionObserverCallback;
  elements: Element[];
  instance: IntersectionObserver;
}> = [];

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    observers.push({ callback, elements: [], instance: this as unknown as IntersectionObserver });
  }
  private get entry() {
    return observers.find((o) => o.instance === (this as unknown as IntersectionObserver));
  }
  observe(el: Element) {
    this.entry?.elements.push(el);
  }
  unobserve(el: Element) {
    const found = this.entry;
    if (!found) return;
    const index = found.elements.indexOf(el);
    if (index !== -1) found.elements.splice(index, 1);
  }
  disconnect() {
    const found = this.entry;
    if (found) found.elements.length = 0;
  }
  takeRecords() {
    return [];
  }
}

/** Everything the grid is currently observing, in mount order. */
function observedElements(): Element[] {
  return observers.flatMap((o) => o.elements);
}

/** Fires `isIntersecting: true` for one observed slot. */
function scrollIntoView(element: Element): void {
  const owner = observers.find((o) => o.elements.includes(element));
  if (!owner) throw new Error('element is not being observed');
  owner.callback(
    [{ isIntersecting: true, target: element } as IntersectionObserverEntry],
    owner.instance,
  );
  flushSync();
}

function workspace(id: string): Workspace {
  return {
    id: id as WorkspaceId,
    title: `Workspace ${id}`,
    branch: 'main',
    displayStatus: 'in_progress',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    agentSummary: { count: 0, agentIds: [], agents: [] } as Workspace['agentSummary'],
  } as Workspace;
}

let dispatched: Array<{ type: string; payload: unknown[] }>;

/** Workspace ids the grid asked to read, per read kind. */
function readsOf(type: string): string[] {
  return dispatched.filter((action) => action.type === type).map((action) => String(action.payload[0]));
}

beforeAll(() => appStore.init());
afterAll(() => appStore.dispose());

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  appStore.dispatch(resetWorkspaceState());
  appStore.dispatch(hudActivated());
  for (const id of ['ws-1', 'ws-2', 'ws-3']) {
    appStore.dispatch(setWorkspaceEntity(workspace(id)));
  }
  dispatched = [];
  // Record every dispatch, but swallow the two read actions so the test does
  // not drive the real lifecycle saga into the daemon; everything else (store
  // setup from inside a test) still reaches the reducers.
  const realDispatch = appStore.dispatch.bind(appStore);
  vi.spyOn(appStore, 'dispatch').mockImplementation((action: any) => {
    dispatched.push(action);
    if (action?.type === TASKS_READ || action?.type === TOKENS_READ) return action;
    return realDispatch(action);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HudWorkspaceGrid per-workspace read gating', () => {
  it('issues no reads for cards that are rendered but off-viewport', () => {
    render(HudWorkspaceGrid);
    flushSync();

    expect(observedElements()).toHaveLength(3);
    expect(readsOf(TASKS_READ)).toEqual([]);
    expect(readsOf(TOKENS_READ)).toEqual([]);
  });

  it('issues exactly one read pair for a card scrolled into view, and only for it', () => {
    render(HudWorkspaceGrid);
    flushSync();

    const [first] = observedElements();
    scrollIntoView(first);

    expect(readsOf(TASKS_READ)).toEqual(['ws-1']);
    expect(readsOf(TOKENS_READ)).toEqual(['ws-1']);

    // Scrolling it out and back in must not re-issue: the daemon-events bridge
    // keeps the rollups fresh after the first read.
    scrollIntoView(first);
    expect(readsOf(TASKS_READ)).toEqual(['ws-1']);
    expect(readsOf(TOKENS_READ)).toEqual(['ws-1']);
  });

  it('falls back to reading every rendered card where IntersectionObserver is missing', () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    render(HudWorkspaceGrid);
    flushSync();

    expect(readsOf(TASKS_READ)).toEqual(['ws-1', 'ws-2', 'ws-3']);
    expect(readsOf(TOKENS_READ)).toEqual(['ws-1', 'ws-2', 'ws-3']);
  });

  it('reads the active workspace even while its card is off-viewport', () => {
    appStore.dispatch(setActiveWorkspaceId('ws-2'));
    render(HudWorkspaceGrid);
    flushSync();

    expect(readsOf(TASKS_READ)).toEqual(['ws-2']);
    expect(readsOf(TOKENS_READ)).toEqual(['ws-2']);
  });
});
