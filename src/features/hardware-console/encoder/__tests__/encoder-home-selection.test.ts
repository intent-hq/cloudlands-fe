/** @vitest-environment jsdom */
import {
  useEncoderEffortHarness,
  mocks,
  manager,
  flush,
  mutations,
  ready,
} from './encoder-effort.fixture';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    for (let i = 0; i < 4; i += 1) device.turn('clockwise');
    expect(list.picks).toEqual(['a', 'b', 'c']);
    for (let i = 0; i < 3; i += 1) device.turn('counterclockwise');
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
    device.turn('clockwise');
    await flush();
    expect(list.picks).toEqual([]);
    expect(mutations()).toHaveLength(0);
  });

  it('keeps adjusting effort in a chat', async () => {
    ready();
    const list = homeList(['a', 'b']);
    const device = manager();
    device.turn('clockwise');
    await flush();
    expect(list.picks).toEqual([]);
    expect(mutations().map(([, params]) => (params as { changes: unknown }).changes)).toEqual([
      { reasoningEffort: 'low' },
    ]);
  });

  it('moves the Home list in Switch tabs mode too', () => {
    mocks.dispatch(hydrateHardwareConsoleEncoderBehavior('workspace-switch'));
    window.history.replaceState(null, '', '/');
    const list = homeList(['a', 'b']);
    const device = manager();
    device.turn('clockwise');
    device.turn('clockwise');
    expect(list.picks).toEqual(['a', 'b']);
    expect(device.showWorkspace).not.toHaveBeenCalled();
  });
});

describe('encoder press on Home', () => {
  function press(device: ReturnType<typeof manager>) {
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 1 } });
  }

  it('opens the selected workspace', () => {
    ready();
    window.history.replaceState(null, '', '/');
    homeList(['a', 'b', 'c']);
    const device = manager();
    device.turn('clockwise');
    device.turn('clockwise');
    press(device);
    expect(device.showWorkspace.mock.calls).toEqual([['b']]);
    expect(device.navigate).not.toHaveBeenCalled();
  });

  it('opens the previewed workspace even when its group is collapsed', () => {
    ready();
    window.history.replaceState(null, '', '/');
    const list = homeList(['a']);
    list.selected = 'b';
    const device = manager();
    press(device);
    expect(device.showWorkspace.mock.calls).toEqual([['b']]);
    expect(device.navigate).not.toHaveBeenCalled();
  });

  it('opens Home when nothing is selected', () => {
    ready();
    window.history.replaceState(null, '', '/');
    homeList(['a', 'b']);
    const device = manager();
    press(device);
    expect(device.showWorkspace).not.toHaveBeenCalled();
    expect(device.navigate.mock.calls).toEqual([['/']]);
  });

  it('opens Home when the workspace list is not showing', () => {
    ready();
    window.history.replaceState(null, '', '/');
    const list = homeList(null);
    list.selected = 'a';
    const device = manager();
    press(device);
    expect(device.showWorkspace).not.toHaveBeenCalled();
    expect(device.navigate.mock.calls).toEqual([['/']]);
  });

  it('opens Home from a chat even if Home kept a selection', () => {
    ready();
    const list = homeList(['a', 'b']);
    list.selected = 'a';
    const device = manager();
    press(device);
    expect(device.showWorkspace).not.toHaveBeenCalled();
    expect(device.navigate.mock.calls).toEqual([['/']]);
  });
});

describe('encoder press that opens Home', () => {
  function openHomeFromChat() {
    ready();
    const list = homeList(['a', 'b']);
    list.selected = 'a';
    const device = manager();
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 1 } });
    window.history.replaceState(null, '', '/');
    return device;
  }

  it('stays on Home when the press bounces', () => {
    const device = openHomeFromChat();
    vi.advanceTimersByTime(30);
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 0 } });
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 1 } });
    expect(device.showWorkspace).not.toHaveBeenCalled();
  });

  it('stays on Home while the knob is held and repeats, then lets a later press open', () => {
    const device = openHomeFromChat();
    for (let i = 0; i < 6; i += 1) {
      vi.advanceTimersByTime(400);
      device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 1 } });
    }
    expect(device.showWorkspace).not.toHaveBeenCalled();
    expect(device.navigate).toHaveBeenCalledTimes(7);
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 0 } });
    vi.advanceTimersByTime(800);
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 1 } });
    expect(device.showWorkspace.mock.calls).toEqual([['a']]);
  });

  it('opens a row picked by turning, even right after opening Home', () => {
    const device = openHomeFromChat();
    vi.advanceTimersByTime(200);
    device.turn('clockwise');
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 1 } });
    expect(device.showWorkspace.mock.calls).toEqual([['b']]);
  });

  it('opens the selected workspace on a later, separate press', () => {
    const device = openHomeFromChat();
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 0 } });
    vi.advanceTimersByTime(1000);
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 1 } });
    expect(device.showWorkspace.mock.calls).toEqual([['a']]);
  });
});
