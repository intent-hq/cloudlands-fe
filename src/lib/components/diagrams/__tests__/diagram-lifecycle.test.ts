import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiagramPrimitive } from '$shared/types/notes-primitives';
import DiagramRenderer from '../DiagramRenderer.svelte';

function diagram(id: string, stateIds = ['start', 'finish']): DiagramPrimitive {
  return {
    id,
    type: 'diagram',
    version: 1,
    createdAt: '2026-09-12T00:00:00.000Z',
    createdBy: 'user',
    grammar: 'flowchart',
    model: {
      nodes: [
        { id: `${id}-one`, label: `${id} first`, kind: 'process' },
        { id: `${id}-two`, label: `${id} second`, kind: 'process' },
      ],
      edges: [],
    },
    baseView: { layout: { type: 'layered', direction: 'LR' } },
    states: stateIds.map((stateId, index) => ({
      id: stateId,
      visibleNodes: [`${id}-${index === 0 ? 'one' : 'two'}`],
    })),
    currentStateId: stateIds[0],
  };
}

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let scrollTo: ReturnType<typeof vi.fn>;

async function deliverFrames() {
  const pending = [...frames];
  frames.clear();
  for (const [, callback] of pending) callback(performance.now());
  await tick();
}

beforeEach(() => {
  document.documentElement.classList.add('catalog-reduced-motion');
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  scrollTo = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: scrollTo,
  });
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('catalog-reduced-motion');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function steps(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-diagram-step-index]')];
}

async function expectScene(container: HTMLElement, nodeId: string, selected: number, total = 2) {
  await waitFor(() => {
    expect(
      [...container.querySelectorAll('[data-node-id]')].map((e) => e.getAttribute('data-node-id')),
    ).toEqual([nodeId]);
    expect(steps(container).map((step) => step.tabIndex)).toEqual(
      Array.from({ length: total }, (_, index) => (index === selected ? 0 : -1)),
    );
    expect(steps(container)[selected].getAttribute('aria-current')).toBe('step');
    expect(container.querySelector('.step-counter')?.textContent).toBe(`${selected + 1}/${total}`);
  });
}

describe('diagram prop lifecycle', () => {
  it('settles a lane resize across the compact-padding breakpoint without feedback', async () => {
    let width = 581;
    let resize!: () => void;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const input = diagram('resize');
    input.baseView.layout.direction = 'TB';
    const result = render(DiagramRenderer, { props: { diagram: input } });
    await expectScene(result.container, 'resize-one', 0);
    await fireEvent.click(steps(result.container)[1]);
    width = 505;
    resize();
    await tick();
    await expectScene(result.container, 'resize-two', 1);
    await waitFor(async () => {
      await deliverFrames();
      expect(
        result.container.querySelector('.diagram-renderer')?.getAttribute('data-diagram-settled'),
      ).toBe('true');
    });
    await fireEvent.click(steps(result.container)[0]);
    await expectScene(result.container, 'resize-one', 0);
  });

  it('keeps visible paint through a disjoint scene handoff, including zero-opacity entry', async () => {
    document.documentElement.classList.remove('catalog-reduced-motion');
    // jsdom does not supply the browser's initial opacity or apply WAAPI keyframes.
    const style = document.createElement('style');
    style.textContent = 'foreignObject { opacity: 1; }';
    document.head.append(style);
    const running = new Map<Animation, () => void>();
    vi.spyOn(Element.prototype, 'animate').mockImplementation(function (this: Element, keyframes) {
      const element = this as SVGElement;
      const frames = keyframes as Keyframe[];
      const originalOpacity = element.style.opacity;
      const apply = (frame: Keyframe | undefined) => {
        if (frame?.opacity !== undefined) element.style.opacity = String(frame.opacity);
      };
      apply(frames[0]);
      let resolve!: (value: Animation) => void;
      let playState: AnimationPlayState = 'running';
      const animation = {
        get playState() {
          return playState;
        },
        effect: { getComputedTiming: () => ({ endTime: 1 }) },
        finished: new Promise<Animation>((done) => {
          resolve = done;
        }),
        cancel: () => {
          running.delete(animation);
          element.style.opacity = originalOpacity;
          playState = 'idle';
          resolve(animation);
        },
      } as unknown as Animation;
      running.set(animation, () => {
        apply(frames.at(-1));
        playState = 'finished';
        running.delete(animation);
        resolve(animation);
        animation.onfinish?.call(animation, new Event('finish') as AnimationPlaybackEvent);
      });
      return animation;
    });
    vi.spyOn(Element.prototype, 'getAnimations').mockImplementation(() => [...running.keys()]);
    try {
      const result = render(DiagramRenderer, { props: { diagram: diagram('A') } });
      await expectScene(result.container, 'A-one', 0);
      await fireEvent.click(steps(result.container)[1]);
      const visibleNodes = () =>
        [...result.container.querySelectorAll('[data-node-id]')].filter(
          (node) => Number(getComputedStyle(node).opacity) > 0.01,
        );
      for (let frame = 0; frame < 16; frame += 1) {
        expect(visibleNodes().length, `visible paint before frame ${frame}`).toBeGreaterThan(0);
        for (const finish of [...running.values()]) finish();
        await deliverFrames();
        expect(visibleNodes().length, `visible paint after frame ${frame}`).toBeGreaterThan(0);
      }
      await expectScene(result.container, 'A-two', 1);
      expect(running.size).toBe(0);
    } finally {
      style.remove();
    }
  });

  it('cannot transfer queued step focus to a replacement with matching step identifiers', async () => {
    const result = render(DiagramRenderer, { props: { diagram: diagram('A') } });
    await expectScene(result.container, 'A-one', 0);
    steps(result.container)[0].focus();
    await fireEvent.keyDown(steps(result.container)[0], { key: 'ArrowRight' });
    const incoming = diagram('B');
    incoming.currentStateId = 'finish';
    await result.rerender({ diagram: incoming });
    const fit = result.container.querySelector<HTMLButtonElement>('.diagram-fit-button')!;
    fit.focus();
    await deliverFrames();
    await expectScene(result.container, 'B-two', 1);
    expect(document.activeElement).toBe(fit);
  });

  it('cancels queued focus on unmount and uses non-scrolling focus for the latest keyboard step', async () => {
    const result = render(DiagramRenderer, { props: { diagram: diagram('A') } });
    await expectScene(result.container, 'A-one', 0);
    const buttons = steps(result.container);
    const focus = vi.spyOn(buttons[1], 'focus');
    await fireEvent.keyDown(buttons[0], { key: 'ArrowRight' });
    await deliverFrames();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    await fireEvent.keyDown(buttons[1], { key: 'Home' });
    result.unmount();
    expect(frames.size).toBe(0);
    await deliverFrames();
    expect(document.activeElement).not.toBe(buttons[0]);
  });

  it('leaves existing initial saved-state semantics unchanged', async () => {
    const incoming = diagram('A');
    incoming.currentStateId = 'unlisted';
    const before = JSON.stringify(incoming);
    const onUpdate = vi.fn();
    const result = render(DiagramRenderer, { props: { diagram: incoming, onUpdate } });
    await waitFor(() => {
      expect(
        result.container.querySelector('.diagram-renderer')?.getAttribute('data-diagram-state'),
      ).toBe('unlisted');
      expect(
        [...result.container.querySelectorAll('[data-node-id]')].map((e) =>
          e.getAttribute('data-node-id'),
        ),
      ).toEqual(['A-one', 'A-two']);
    });
    expect(JSON.stringify(incoming)).toBe(before);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['idle', 'done'],
    ['start', 'finish'],
  ])(
    'uses the incoming selection on same-instance identity replacement (%s/%s)',
    async (first, second) => {
      const original = diagram('A');
      const replacement = diagram('B', [first, second]);
      replacement.currentStateId = second;
      const before = JSON.stringify([original, replacement]);
      const onUpdate = vi.fn();
      const result = render(DiagramRenderer, { props: { diagram: original, onUpdate } });
      const root = result.container.querySelector('.diagram-renderer');
      await expectScene(result.container, 'A-one', 0);
      await result.rerender({ diagram: replacement });
      expect(result.container.querySelector('.diagram-renderer')).toBe(root);
      await expectScene(result.container, 'B-two', 1);
      expect(JSON.stringify([original, replacement])).toBe(before);
      expect(onUpdate).not.toHaveBeenCalled();
      steps(result.container)[1].focus();
      await fireEvent.keyDown(steps(result.container)[1], { key: 'Home' });
      await deliverFrames();
      await expectScene(result.container, 'B-one', 0);
      expect(document.activeElement).toBe(steps(result.container)[0]);
      expect(onUpdate.mock.calls).toEqual([[{ currentStateId: first }]]);
    },
  );

  it('reconciles a removed local selection without changing or persisting the incoming payload', async () => {
    const original = diagram('A');
    const onUpdate = vi.fn();
    const result = render(DiagramRenderer, { props: { diagram: original, onUpdate } });
    await fireEvent.click(steps(result.container)[1]);
    await expectScene(result.container, 'A-two', 1);
    const replacement = {
      ...original,
      states: original.states!.slice(0, 1),
      currentStateId: 'finish',
    };
    const before = JSON.stringify(replacement);
    await result.rerender({ diagram: replacement });
    await expectScene(result.container, 'A-one', 0, 1);
    expect(JSON.stringify(replacement)).toBe(before);
    expect(onUpdate.mock.calls).toEqual([[{ currentStateId: 'finish' }]]);
  });

  it('preserves a valid local selection across equivalent objects, reordered states and onUpdate echoes', async () => {
    const original = diagram('A');
    const onUpdate = vi.fn();
    const result = render(DiagramRenderer, { props: { diagram: original, onUpdate } });
    await fireEvent.click(steps(result.container)[1]);
    await result.rerender({ diagram: structuredClone(original) });
    await expectScene(result.container, 'A-two', 1);
    await result.rerender({
      diagram: { ...structuredClone(original), ...onUpdate.mock.calls[0][0] },
    });
    await expectScene(result.container, 'A-two', 1);
    await result.rerender({ diagram: { ...original, states: [...original.states!].reverse() } });
    await expectScene(result.container, 'A-two', 0);
    expect(original.currentStateId).toBe('start');
    expect(onUpdate.mock.calls).toEqual([[{ currentStateId: 'finish' }]]);
  });

  it('reconciles stateless to stateful and back within the same identity', async () => {
    const stateful = diagram('A');
    stateful.currentStateId = 'finish';
    const stateless = { ...stateful, states: undefined, currentStateId: undefined };
    const onUpdate = vi.fn();
    const result = render(DiagramRenderer, { props: { diagram: stateless, onUpdate } });
    expect(result.container.querySelectorAll('[data-node-id]')).toHaveLength(2);
    await result.rerender({ diagram: stateful });
    await expectScene(result.container, 'A-two', 1);
    await result.rerender({ diagram: stateless });
    await waitFor(() =>
      expect(result.container.querySelectorAll('[data-node-id]')).toHaveLength(2),
    );
    expect(steps(result.container)).toHaveLength(0);
    expect(
      result.container.querySelector('.diagram-renderer')?.hasAttribute('data-diagram-state'),
    ).toBe(false);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('defaults an incoming diagram without a saved selection to its first state', async () => {
    const result = render(DiagramRenderer, { props: { diagram: diagram('A') } });
    const incoming = diagram('B', ['idle', 'done']);
    incoming.currentStateId = undefined;
    await result.rerender({ diagram: incoming });
    await expectScene(result.container, 'B-one', 0);
  });

  it('invalidates a pending disjoint entry before it can advance the replacement scene', async () => {
    document.documentElement.classList.remove('catalog-reduced-motion');
    const onUpdate = vi.fn();
    const result = render(DiagramRenderer, { props: { diagram: diagram('A'), onUpdate } });
    await fireEvent.click(steps(result.container)[1]);
    expect(
      result.container
        .querySelector('.diagram-renderer')
        ?.getAttribute('data-diagram-motion-phase'),
    ).toBe('scene');
    expect(frames.size).toBeGreaterThan(0);
    await result.rerender({ diagram: diagram('B') });
    await deliverFrames();
    await deliverFrames();
    await expectScene(result.container, 'B-one', 0);
    expect(onUpdate.mock.calls).toEqual([[{ currentStateId: 'finish' }]]);
  });

  it('keeps the active transition and handoff paint on a parent echo', async () => {
    document.documentElement.classList.remove('catalog-reduced-motion');
    const original = diagram('A');
    const onUpdate = vi.fn();
    const result = render(DiagramRenderer, { props: { diagram: original, onUpdate } });
    await fireEvent.click(steps(result.container)[1]);
    const scene = result.container.querySelector('g.diagram-geometry-motion');
    const nodes = [...result.container.querySelectorAll('[data-node-id]')];
    await result.rerender({ diagram: { ...structuredClone(original), currentStateId: 'finish' } });
    expect(result.container.querySelector('g.diagram-geometry-motion') === scene).toBe(true);
    expect([...result.container.querySelectorAll('[data-node-id]')]).toEqual(nodes);
    expect(
      result.container
        .querySelector('.diagram-renderer')
        ?.getAttribute('data-diagram-motion-phase'),
    ).toBe('scene');
    // Disjoint entry bridges the outgoing exit before compact destination fitting.
    await waitFor(async () => {
      await deliverFrames();
      expect(
        result.container
          .querySelector('.diagram-renderer')
          ?.getAttribute('data-diagram-motion-phase'),
      ).toBe('camera');
    });
    await waitFor(async () => {
      await deliverFrames();
      expect(
        result.container
          .querySelector('.diagram-renderer')
          ?.getAttribute('data-diagram-motion-phase'),
      ).toBe('scene');
    });
    await expectScene(result.container, 'A-two', 1);
    expect(onUpdate.mock.calls).toEqual([[{ currentStateId: 'finish' }]]);
  });

  it('invalidates the compact destination camera before it can advance replacement paint', async () => {
    document.documentElement.classList.remove('catalog-reduced-motion');
    const onUpdate = vi.fn();
    const result = render(DiagramRenderer, { props: { diagram: diagram('A'), onUpdate } });
    await fireEvent.click(steps(result.container)[1]);
    await waitFor(async () => {
      await deliverFrames();
      expect(
        result.container
          .querySelector('.diagram-renderer')
          ?.getAttribute('data-diagram-motion-phase'),
      ).toBe('camera');
    });
    await result.rerender({ diagram: diagram('B') });
    await deliverFrames();
    await deliverFrames();
    await expectScene(result.container, 'B-one', 0);
    expect(onUpdate.mock.calls).toEqual([[{ currentStateId: 'finish' }]]);
  });
});

describe('fit frame ownership', () => {
  it('cancels queued fit work before unmount, with no later layout reads or scroll writes', async () => {
    const result = render(DiagramRenderer, { props: { diagram: diagram('A', []) } });
    await fireEvent.click(result.getByRole('button', { name: 'Fit diagram to width' }));
    const scroller = result.container.querySelector('.diagram-scroll-container')!;
    const readWidth = vi.fn(() => 600);
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, get: readWidth });
    result.unmount();
    scrollTo.mockClear();
    expect(frames.size).toBe(0);
    await deliverFrames();
    expect(readWidth).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('coalesces repeated fit toggles into only the latest frame', async () => {
    const result = render(DiagramRenderer, { props: { diagram: diagram('A', []) } });
    const fit = result.getByRole('button', { name: 'Fit diagram to width' });
    await fireEvent.click(fit);
    await fireEvent.click(fit);
    await fireEvent.click(fit);
    scrollTo.mockClear();
    await deliverFrames();
    expect(fit.getAttribute('aria-pressed')).toBe('true');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await deliverFrames();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('cancels queued fit work when its view is reset or diagram replaced', async () => {
    const original = diagram('A', []);
    const result = render(DiagramRenderer, { props: { diagram: original, viewResetKey: 'first' } });
    await fireEvent.click(result.getByRole('button', { name: 'Fit diagram to width' }));
    await result.rerender({ diagram: original, viewResetKey: 'second' });
    scrollTo.mockClear();
    await deliverFrames();
    expect(scrollTo).not.toHaveBeenCalled();
    await fireEvent.click(result.getByRole('button', { name: 'Fit diagram to width' }));
    await result.rerender({ diagram: diagram('B', []) });
    scrollTo.mockClear();
    await deliverFrames();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
