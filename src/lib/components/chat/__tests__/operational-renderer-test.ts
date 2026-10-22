import {
  cleanup,
  render as renderComponent,
  fireEvent as dispatchEvent,
} from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { beforeEach, afterEach, vi } from 'vitest';

// jsdom has no layout. Semantic renderer tests supply a small visible viewport
// and explicitly drain successive frames through the real panel policy. Physical
// per-frame bounds and browser geometry are asserted by operational-row-window CT.
let callbacks = new Map<number, FrameRequestCallback>();
let nextId = 0;
let frameTime = 0;
let geometry: ReturnType<typeof vi.spyOn>;
let timeline: PropertyDescriptor | undefined;
let raf = (callback: FrameRequestCallback) => {
  const id = ++nextId;
  callbacks.set(id, callback);
  return id;
};
function installFrames() {
  vi.spyOn(performance, 'now').mockImplementation(() => frameTime);
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
}
beforeEach(() => {
  callbacks = new Map();
  raf = (callback: FrameRequestCallback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  };
  frameTime = 0;
  document.documentElement.setAttribute('data-reduce-motion', '');
  const original = HTMLElement.prototype.getBoundingClientRect;
  geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (
      this.closest('[data-operational-stack]') ||
      this.querySelector('[data-operational-stack]')
    ) {
      const height =
        this.hasAttribute('data-operational-window-key') &&
        !this.querySelector('[data-testid="response-group"]')
          ? 28
          : 800;
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 600,
        bottom: height,
        width: 600,
        height,
        toJSON: () => ({}),
      };
    }
    return original.call(this);
  });
  timeline = Object.getOwnPropertyDescriptor(document, 'timeline');
  Object.defineProperty(document, 'timeline', {
    configurable: true,
    value: {
      get currentTime() {
        return frameTime;
      },
    },
  });
  installFrames();
});
afterEach(async () => {
  installFrames();
  cleanup();
  await settleOperationalFrames();
  callbacks.clear();
  geometry.mockRestore();
  document.documentElement.removeAttribute('data-reduce-motion');
  vi.mocked(performance.now).mockRestore?.();
  if (timeline) Object.defineProperty(document, 'timeline', timeline);
  else Reflect.deleteProperty(document, 'timeline');
  vi.unstubAllGlobals();
});

function flushOperationalFrames() {
  for (let frame = 0; frame < 20; frame++) {
    flushSync();
    if (!callbacks.size) break;
    const pending = [...callbacks.values()];
    callbacks.clear();
    frameTime += 16;
    pending.forEach((callback) => callback(frameTime));
  }
  flushSync();
}

export async function settleOperationalFrames() {
  for (let frame = 0; frame < 30; frame++) {
    await tick();
    flushSync();
    if (!callbacks.size) {
      await tick();
      if (!callbacks.size) break;
    }
    const pending = [...callbacks.values()];
    callbacks.clear();
    frameTime += 16;
    pending.forEach((callback) => callback(frameTime));
  }
  await tick();
  flushSync();
}

export const render: typeof renderComponent = ((...args: Parameters<typeof renderComponent>) => {
  installFrames();
  const result = renderComponent(...args);
  flushOperationalFrames();
  const rerender = result.rerender;
  result.rerender = async (...props: Parameters<typeof rerender>) => {
    await rerender(...props);
    await settleOperationalFrames();
  };
  return result;
}) as typeof renderComponent;

export const fireEvent = Object.assign(
  async (...args: Parameters<typeof dispatchEvent>) => {
    const result = await dispatchEvent(...args);
    await settleOperationalFrames();
    return result;
  },
  Object.fromEntries(
    Object.entries(dispatchEvent).map(([name, dispatch]) => [
      name,
      async (...args: unknown[]) => {
        const result = await (dispatch as (...args: unknown[]) => Promise<boolean>)(...args);
        await settleOperationalFrames();
        return result;
      },
    ]),
  ),
) as unknown as typeof dispatchEvent;
