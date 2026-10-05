import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import DiagramEdge from '../DiagramEdge.svelte';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('attaches a retained route to the painted y/height pose, not an independent route clock', async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const source = document.createElementNS(svg.namespaceURI, 'foreignObject');
  source.setAttribute('data-node-id', 'source');
  svg.append(source);
  document.body.append(svg);
  const painted = { x: 10, y: 20, width: 80, height: 40 };
  const destination = { ...painted, y: 80, height: 60 };
  for (const property of ['x', 'y', 'width', 'height'] as const) {
    Object.defineProperty(source, property, {
      value: { baseVal: { value: destination[property] } },
    });
  }
  const getStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((node, pseudo) =>
    node === source
      ? ({
          getPropertyValue: (property: keyof typeof painted) => `${painted[property]}px`,
        } as CSSStyleDeclaration)
      : getStyle(node, pseudo),
  );
  Object.defineProperty(source, 'getAnimations', {
    value: () => [
      { transitionProperty: 'y', effect: { getComputedTiming: () => ({ progress: 0 }) } },
    ],
  });
  const edge = {
    id: 'route',
    from: 'source',
    to: 'target',
    path: 'M 50 60 L 50 240',
    points: [
      { x: 50, y: 60 },
      { x: 50, y: 240 },
    ],
  };
  const result = render(DiagramEdge, { target: svg, props: { edge } });
  await result.rerender({
    edge: {
      ...edge,
      path: 'M 50 140 L 50 280',
      points: [
        { x: 50, y: 140 },
        { x: 50, y: 280 },
      ],
    },
  });
  const started = performance.now();
  const paths = [];
  for (const [elapsed, y, height] of [
    [40, 20, 40],
    [90, 30, 42],
    [150, 65, 53],
  ]) {
    Object.assign(painted, { y, height });
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(started + elapsed);
    await tick();
    const path = svg.querySelector('.edge-path')!.getAttribute('d')!;
    const [, x, endpointY] = /^M (\S+) (\S+)/.exec(path)!;
    expect(Number(x)).toBeGreaterThanOrEqual(painted.x);
    expect(Number(x)).toBeLessThanOrEqual(painted.x + painted.width);
    expect(Number(endpointY)).toBeCloseTo(painted.y + painted.height, 5);
    paths.push(path);
  }
  expect(new Set(paths).size).toBe(3);
  result.unmount();
  expect(frames.size).toBe(0);
  svg.remove();
});
