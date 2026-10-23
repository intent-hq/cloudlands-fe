import { flushSync } from 'svelte';
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

  function mount(initial: HomeFilter) {
    const state = $state({
      filter: initial,
      workspaces: [row('a')] as Workspace[],
      preview: false,
    });
    cleanup = $effect.root(() => {
      homeRetiredWorkspaces({
        filter: () => state.filter,
        preview: () => state.preview,
        workspaces: () => state.workspaces,
      });
    });
    flushSync();
    return state;
  }

  it('loads once on entering Retired; list responses do not trigger another load', () => {
    const state = mount('all');
    expect(loads()).toBe(0);

    state.filter = 'retired';
    flushSync();
    expect(loads()).toBe(1);

    // Each retired-list response upserts rows and changes the list reference.
    for (let i = 0; i < 3; i += 1) {
      state.workspaces = [...state.workspaces, row(`r${i}`, WorkspaceStatusEnum.Retired)];
      flushSync();
    }
    expect(loads()).toBe(1);
  });

  it('reloads on leaving and re-entering Retired', () => {
    const state = mount('retired');
    expect(loads()).toBe(1);
    state.filter = 'all';
    flushSync();
    state.filter = 'retired';
    flushSync();
    expect(loads()).toBe(2);
  });

  it('reloads when an ordinary refresh drops the retired rows while on Retired', () => {
    const state = mount('retired');
    state.workspaces = [row('a'), row('r', WorkspaceStatusEnum.Retired)];
    flushSync();
    expect(loads()).toBe(1);
    state.workspaces = [row('a')];
    flushSync();
    expect(loads()).toBe(2);
  });

  it('never loads in preview mode', () => {
    const state = mount('retired');
    dispatch.mockClear();
    state.preview = true;
    state.filter = 'all';
    flushSync();
    state.filter = 'retired';
    flushSync();
    expect(loads()).toBe(0);
  });
});
