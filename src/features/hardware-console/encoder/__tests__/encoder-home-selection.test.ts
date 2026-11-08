/** @vitest-environment jsdom */
import {
  useEncoderEffortHarness,
  mocks,
  manager,
  flush,
  mutations,
  ready,
} from './encoder-effort.fixture';
import { afterEach, describe, expect, it } from 'vitest';
import { hydrateHardwareConsoleEncoderBehavior } from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { registerHomeEncoderTarget } from '$features/home/home-encoder-target';

useEncoderEffortHarness();

let unregister: (() => void) | null = null;
afterEach(() => {
  unregister?.();
  unregister = null;
});

function homeList(ids: string[] | null) {
  const target = {
    selected: null as string | null,
    ids: () => ids,
    selectedId: () => target.selected,
    select: (id: string) => {
      target.selected = id;
      target.picks.push(id);
    },
    picks: [] as string[],
  };
  unregister = registerHomeEncoderTarget(target);
  return target;
}

describe('encoder rotation on Home', () => {
  it('selects down the list turning right and up turning left, without wrapping', async () => {
    ready();
    window.history.replaceState(null, '', '/');
    const list = homeList(['a', 'b', 'c']);
    const device = manager('creator-micro-2');
    for (let i = 0; i < 4; i += 1) device.turn('cw');
    expect(list.picks).toEqual(['a', 'b', 'c']);
    for (let i = 0; i < 3; i += 1) device.turn('ccw');
    expect(list.picks).toEqual(['a', 'b', 'c', 'b', 'a']);
    await flush();
    expect(mutations()).toHaveLength(0);
    expect(device.showWorkspace).not.toHaveBeenCalled();
  });

  it('leaves Home alone when its workspace list is not showing', async () => {
    ready();
    window.history.replaceState(null, '', '/');
    const list = homeList(null);
    const device = manager();
    device.turn('cw');
    await flush();
    expect(list.picks).toEqual([]);
    expect(mutations()).toHaveLength(0);
  });

  it('keeps adjusting effort in a chat', async () => {
    ready();
    const list = homeList(['a', 'b']);
    const device = manager();
    device.turn('cw');
    await flush();
    expect(list.picks).toEqual([]);
    expect(mutations().map(([, params]) => (params as { changes: unknown }).changes)).toEqual([
      { reasoningEffort: 'low' },
    ]);
  });

  it('keeps workspace switching when that rotation setting is chosen', () => {
    mocks.dispatch(hydrateHardwareConsoleEncoderBehavior('workspace-switch'));
    window.history.replaceState(null, '', '/');
    const list = homeList(['a', 'b']);
    const device = manager();
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CW', act: 2 } });
    expect(list.picks).toEqual([]);
    expect(device.showWorkspace).toHaveBeenCalledTimes(1);
  });
});
