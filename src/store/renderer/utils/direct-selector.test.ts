/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, readable, writable } from 'svelte/store';

import { store as appStore } from '../store';
import { directSelectorReadable } from './direct-selector';
import { selectDaemonHealth } from '../slices/daemon-health/daemon-health-selectors';
import { connectionStatusChanged } from '../slices/daemon-health/daemon-health-slice';
import { selectWorkspaceById } from '../slices/workspace/workspace-selectors';
import { replaceWorkspaceList } from '../slices/workspace/workspace-slice';
import { WorkspaceId } from '$shared/types/branded-ids';
import { createMockWorkspace } from '../../../test/factories/workspace.factory';

describe('directSelectorReadable (#4622)', () => {
  let disposeStore: (() => void) | undefined;

  beforeEach(() => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    disposeStore = appStore.init();
  });

  afterEach(() => {
    disposeStore?.();
    disposeStore = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('delivers each dispatch synchronously without an animation frame', () => {
    const seen: string[] = [];
    const unsubscribe = directSelectorReadable(selectDaemonHealth).subscribe((value) =>
      seen.push(value),
    );
    appStore.dispatch(connectionStatusChanged('connected', { mode: 'sidecar-uds' }));
    expect(seen).toEqual(['down', 'healthy']);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('notifies only when the projected value changes', () => {
    const run = vi.fn();
    const unsubscribe = directSelectorReadable(selectDaemonHealth).subscribe(run);
    appStore.dispatch(replaceWorkspaceList([]));
    appStore.dispatch(replaceWorkspaceList([]));
    expect(run).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('re-selects when a readable argument changes', () => {
    const first = WorkspaceId('ws-first');
    const second = WorkspaceId('ws-second');
    appStore.dispatch(
      replaceWorkspaceList([
        createMockWorkspace({ id: first, title: 'First' }),
        createMockWorkspace({ id: second, title: 'Second' }),
      ]),
    );
    const id$ = writable<string>(first);
    const workspace$ = directSelectorReadable(selectWorkspaceById, id$);
    expect(get(workspace$)?.title).toBe('First');
    const titles: Array<string | undefined> = [];
    const unsubscribe = workspace$.subscribe((workspace) => titles.push(workspace?.title));
    id$.set(second);
    expect(titles).toEqual(['First', 'Second']);
    unsubscribe();
  });

  it('holds the store and argument subscriptions only while subscribed', () => {
    let live = 0;
    const getReadableState = appStore.getReadableState.bind(appStore);
    vi.spyOn(appStore, 'getReadableState').mockImplementation(() => {
      const state$ = getReadableState();
      return {
        subscribe(run: Parameters<typeof state$.subscribe>[0]) {
          live += 1;
          const unsubscribe = state$.subscribe(run);
          return () => {
            live -= 1;
            unsubscribe();
          };
        },
      };
    });
    const argStop = vi.fn();
    const arg$ = readable('ws-none', () => argStop);
    const workspace$ = directSelectorReadable(selectWorkspaceById, arg$);
    expect(live).toBe(0);
    const stopA = workspace$.subscribe(() => {});
    const stopB = workspace$.subscribe(() => {});
    expect(live).toBe(1);
    stopA();
    expect(live).toBe(1);
    stopB();
    expect(live).toBe(0);
    expect(argStop).toHaveBeenCalledTimes(1);
  });

  it('falls back to the selector readable when the selector has no pure select', () => {
    const fallback = readable('stub');
    const selector = Object.assign(() => fallback, {});
    expect(directSelectorReadable(selector)).toBe(fallback);
  });
});
