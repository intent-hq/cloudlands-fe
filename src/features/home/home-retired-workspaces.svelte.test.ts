import { flushSync } from 'svelte';
import { writable } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dispatch = vi.hoisted(() => vi.fn());
vi.mock('$store/renderer/store', () => ({ store: { dispatch } }));

import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import type { HomeFilter } from './home-model';
import { homeRetiredWorkspaces } from './home-retired-workspaces.svelte';

const row = (id: string, status = WorkspaceStatusEnum.Active) =>
  ({ id, title: id, status }) as Workspace;
const loads = () =>
  dispatch.mock.calls.filter(
    ([action]) => action?.type === 'workspaceOperations/loadRetiredWorkspacesRequested',
  ).length;

describe('homeRetiredWorkspaces', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    dispatch.mockClear();
  });

  const admission = writable<unknown>('admission-1');
  function mount(initial: HomeFilter) {
    admission.set('admission-1');
    const workspaces$ = writable<Workspace[]>([row('a')]);
    const state = $state({
      filter: initial,
      preview: false,
      set workspaces(rows: Workspace[]) {
        workspaces$.set(rows);
      },
      get workspaces() {
        let rows: Workspace[] = [];
        workspaces$.subscribe((value) => (rows = value))();
        return rows;
      },
    });
    cleanup = $effect.root(() => {
      homeRetiredWorkspaces(
        () => ({ filter: state.filter, preview: state.preview }),
        workspaces$,
        admission,
      );
    });
    flushSync();
    return state;
  }

  it('loads once on entering Archived; list responses do not trigger another load', () => {
    const state = mount('all');
    expect(loads()).toBe(0);

    state.filter = 'archived';
    flushSync();
    expect(loads()).toBe(1);

    // Each retired-list response upserts rows and changes the list reference.
    for (let i = 0; i < 3; i += 1) {
      state.workspaces = [...state.workspaces, row(`r${i}`, WorkspaceStatusEnum.Retired)];
      flushSync();
    }
    expect(loads()).toBe(1);
  });

  it('reloads on leaving and re-entering Archived', () => {
    const state = mount('archived');
    expect(loads()).toBe(1);
    state.filter = 'all';
    flushSync();
    state.filter = 'archived';
    flushSync();
    expect(loads()).toBe(2);
  });

  it('reloads when an ordinary refresh drops the retired rows while on Archived', () => {
    const state = mount('archived');
    state.workspaces = [row('a'), row('r', WorkspaceStatusEnum.Retired)];
    flushSync();
    expect(loads()).toBe(1);
    state.workspaces = [row('a')];
    flushSync();
    expect(loads()).toBe(2);
  });

  it('never loads in preview mode', () => {
    const state = mount('archived');
    dispatch.mockClear();
    state.preview = true;
    state.filter = 'all';
    flushSync();
    state.filter = 'archived';
    flushSync();
    expect(loads()).toBe(0);
  });

  it('reloads once when admission recovers while Archived stays selected', () => {
    const state = mount('archived');
    expect(loads()).toBe(1);
    // The first read failed or was discarded: nothing retired is loaded.
    admission.set(null);
    flushSync();
    expect(loads()).toBe(2);
    admission.set('admission-2');
    flushSync();
    expect(loads()).toBe(3);

    // The recovered read lands; unchanged admission and list updates do not loop.
    state.workspaces = [row('a'), row('r', WorkspaceStatusEnum.Retired)];
    flushSync();
    admission.set('admission-2');
    flushSync();
    expect(loads()).toBe(3);
    expect(state.workspaces.some((w) => w.status === WorkspaceStatusEnum.Retired)).toBe(true);
  });

  it('does not load on an admission change while another chip is selected', () => {
    mount('all');
    admission.set('admission-2');
    flushSync();
    expect(loads()).toBe(0);
  });
});
