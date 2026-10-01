// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { scheduleLayoutRead } from '$lib/utils/layout-phases';
import DiagramPresentation from '../DiagramPresentation.svelte';

let frames: FrameRequestCallback[];
let resizeCallbacks: (() => void)[];
let applications: ReturnType<typeof mount>[];

beforeEach(() => {
  frames = [];
  resizeCallbacks = [];
  applications = [];
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
});

function frame() {
  const pending = frames.splice(0);
  for (const callback of pending) callback(performance.now());
  flushSync();
}

afterEach(async () => {
  for (const app of applications) await unmount(app);
  frame();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function noteDiagram() {
  const prose = document.createElement('div');
  prose.className = 'tiptap-editor ProseMirror';
  const lane = document.createElement('div');
  lane.className = 'node-diagram_block';
  prose.append(lane);
  document.body.append(prose);
  const laneRead = vi.spyOn(lane, 'clientWidth', 'get');
  const proseRead = vi.spyOn(prose, 'clientWidth', 'get');
  const app = mount(DiagramPresentation, {
    target: lane,
    props: {
      kind: 'custom',
      exportable: false,
      children: createRawSnippet(() => ({
        render: () => '<div data-diagram-intrinsic-width="1200" data-diagram-settled="true"></div>',
      })),
    },
  });
  applications.push(app);
  flushSync();
  return {
    app,
    lane,
    laneRead,
    proseRead,
    content: lane.querySelector('[data-diagram-intrinsic-width]')!,
  };
}

it('defers and coalesces note mount, descendant mutations and resize into a single measurement', async () => {
  const { laneRead, proseRead, content } = noteDiagram();
  for (let i = 0; i < 3; i++) {
    content.append(document.createElement('span'));
    await Promise.resolve(); // Deliver each real MutationObserver burst before the frame.
    resizeCallbacks.forEach((callback) => callback());
  }
  // A dirty subtree must not force synchronous layout in either observer callback.
  expect(laneRead).not.toHaveBeenCalled();
  expect(proseRead).not.toHaveBeenCalled();
  frame();
  expect(laneRead).toHaveBeenCalledTimes(1);
  expect(proseRead).toHaveBeenCalledTimes(1);

  content.setAttribute('data-diagram-settled', 'false');
  await Promise.resolve();
  content.setAttribute('data-diagram-settled', 'true');
  await Promise.resolve();
  frame();
  expect(laneRead).toHaveBeenCalledTimes(2);
  expect(proseRead).toHaveBeenCalledTimes(2);
});

it('reads every diagram before applying the resulting presentation styles', () => {
  const order: string[] = [];
  const diagrams = [noteDiagram(), noteDiagram()];
  const getWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!.get!;
  for (const [index, diagram] of diagrams.entries()) {
    diagram.laneRead.mockImplementation(() => {
      order.push(`read-${index}`);
      return getWidth.call(diagram.lane);
    });
    const style = diagram.lane.querySelector<HTMLElement>('[data-diagram-presentation]')!.style;
    const setText = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'cssText')!.set!;
    vi.spyOn(style, 'cssText', 'set').mockImplementation((value) => {
      order.push(`write-${index}`);
      setText.call(style, value);
    });
  }
  frame();
  expect(order.slice(0, 2)).toEqual(['read-0', 'read-1']);
  expect(order.slice(2)).toContain('write-0');
  expect(order.slice(2)).toContain('write-1');
  expect(order.slice(2).every((event) => event.startsWith('write-'))).toBe(true);
});

it('cancels pending measurement when navigating away from a note', async () => {
  const { app, laneRead, proseRead, content } = noteDiagram();
  frame();
  laneRead.mockClear();
  proseRead.mockClear();
  content.append(document.createElement('span'));
  await Promise.resolve();
  await unmount(app);
  applications = applications.filter((candidate) => candidate !== app);
  frame();
  expect(laneRead).not.toHaveBeenCalled();
  expect(proseRead).not.toHaveBeenCalled();
});

it('cancels the style write when unmounted after measurement but before the write phase', () => {
  const { app, lane, laneRead } = noteDiagram();
  const style = lane.querySelector<HTMLElement>('[data-diagram-presentation]')!.style;
  const write = vi.spyOn(style, 'cssText', 'set');
  scheduleLayoutRead(() => {
    void unmount(app);
    applications = applications.filter((candidate) => candidate !== app);
  });
  frame();
  expect(laneRead).toHaveBeenCalledTimes(1);
  expect(write).not.toHaveBeenCalled();
});
