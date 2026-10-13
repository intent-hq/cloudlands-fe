import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { DocumentSession } from './document-session';
import { SourceJournal } from './source-journal';

beforeAll(() => store.init());
afterAll(() => store.dispose());
// Own only this suite's resize capability; native mutation delivery stays real.
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
let resizeOwners: Array<{ owner: object; descriptor?: PropertyDescriptor }> = [];
beforeEach(() => {
  resizeOwners = [...new Set<object>([globalThis, window])].map((owner) => ({
    owner,
    descriptor: Object.getOwnPropertyDescriptor(owner, 'ResizeObserver'),
  }));
  for (const { owner } of resizeOwners)
    Object.defineProperty(owner, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: TestResizeObserver,
    });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const { owner, descriptor } of resizeOwners.reverse()) {
    if (Reflect.get(owner, 'ResizeObserver') !== TestResizeObserver) continue;
    if (descriptor) Object.defineProperty(owner, 'ResizeObserver', descriptor);
    else Reflect.deleteProperty(owner, 'ResizeObserver');
  }
  resizeOwners = [];
});

const source =
  '| A | B |\n| --- | --- |\n' +
  Array.from({ length: 100 }, (_, i) => `| row${i} ${'text '.repeat(20)} | value${i} |\n`).join('');
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Keep native mutation delivery, but disconnect runaway font observers so the
// regression fails an assertion instead of starving the test runner indefinitely.
async function start() {
  const NativeObserver = globalThis.MutationObserver;
  const fonts: Array<{
    observer: MutationObserver;
    callback: MutationCallback;
    deliveries: number;
    exhausted: boolean;
    target: Node;
  }> = [];
  vi.spyOn(globalThis, 'MutationObserver').mockImplementation(function (callback) {
    let font: (typeof fonts)[number] | undefined;
    const observer = new NativeObserver((records, owner) => {
      if (font && ++font.deliveries > 8) {
        font.exhausted = true;
        observer.disconnect();
        return;
      }
      callback(records, owner);
    });
    const observe = observer.observe.bind(observer);
    observer.observe = (target, options) => {
      if (options?.attributeFilter?.join(',') === 'style,class') {
        font = { observer, callback, deliveries: 0, exhausted: false, target };
        fonts.push(font);
      }
      observe(target, options);
    };
    return observer;
  });
  const scroller = document.createElement('div');
  const host = document.createElement('div');
  scroller.append(host);
  document.body.append(scroller);
  // These inputs select the viewport reader; this test makes no layout claim.
  Object.defineProperties(scroller, {
    clientHeight: { value: 520 },
    clientWidth: { value: 1280 },
  });
  const session = new DocumentSession(new SourceJournal(() => source, 1), host);
  try {
    // Exercise viewport admission without unrelated native caret reveal in jsdom.
    await session.seek(source.indexOf('row0'), false);
    expect(session.projection?.table).toBeDefined();
    await settle();
    expect(session.projection!.table!.window.geometry).toBeDefined();
    expect(
      fonts.some((font) => font.exhausted),
      'startup observer exhausted',
    ).toBe(false);
    const font = fonts.findLast((entry) => entry.target === session.editor!.view.dom);
    expect(font).toBeDefined();
    font!.deliveries = 0;
    return { session, fonts, font: font!, scroller };
  } catch (error) {
    session.destroy();
    for (const font of fonts) font.observer.disconnect();
    scroller.remove();
    throw error;
  }
}

for (const geometry of [false, true]) {
  it(`settles style-only mutations with ${geometry ? 'present' : 'absent'} geometry`, async () => {
    const { session, fonts, font, scroller } = await start();
    try {
      const window = session.projection!.table!.window;
      if (geometry) expect(window.geometry).toBeDefined();
      else delete window.geometry;
      expect(Boolean(window.geometry)).toBe(geometry);
      expect(font.target).toBe(session.editor!.view.dom);
      const resize = vi.spyOn(session, 'resizeTable');
      session.editor!.view.dom.style.setProperty('--observer-test', 'changed');
      await settle();
      expect(font.deliveries).toBeGreaterThan(0);
      expect(font.exhausted, 'target observer exhausted').toBe(false);
      expect(resize).not.toHaveBeenCalled();
    } finally {
      session.destroy();
      for (const font of fonts) font.observer.disconnect();
      scroller.remove();
    }
  });

  it(`refreshes once for a real font change with ${geometry ? 'present' : 'absent'} geometry`, async () => {
    const { session, fonts, font, scroller } = await start();
    try {
      const window = session.projection!.table!.window;
      if (geometry) expect(window.geometry).toBeDefined();
      else delete window.geometry;
      expect(Boolean(window.geometry)).toBe(geometry);
      expect(font.target).toBe(session.editor!.view.dom);
      const resize = vi.spyOn(session, 'resizeTable');
      const beforeFont = getComputedStyle(session.editor!.view.dom).fontSize;
      session.editor!.view.dom.style.fontSize = '19px';
      expect(getComputedStyle(session.editor!.view.dom).fontSize).not.toBe(beforeFont);
      await settle();
      expect(font.deliveries).toBeGreaterThan(0);
      expect(font.exhausted, 'target observer exhausted').toBe(false);
      expect(resize).toHaveBeenCalledTimes(1);
      session.editor!.view.dom.style.setProperty('--observer-test', 'after-font');
      await settle();
      expect(resize).toHaveBeenCalledTimes(1);
    } finally {
      session.destroy();
      for (const font of fonts) font.observer.disconnect();
      scroller.remove();
    }
  });
}

it('defers font refresh during pointer selection without consuming the change', async () => {
  const { session, fonts, font, scroller } = await start();
  const state = session as unknown as { pointerSelecting: boolean };
  try {
    const resize = vi.spyOn(session, 'resizeTable');
    state.pointerSelecting = true;
    const beforeFont = getComputedStyle(session.editor!.view.dom).fontSize;
    session.editor!.view.dom.style.fontSize = '21px';
    expect(getComputedStyle(session.editor!.view.dom).fontSize).not.toBe(beforeFont);
    await settle();
    expect(resize).not.toHaveBeenCalled();
    state.pointerSelecting = false;
    session.editor!.view.dom.style.setProperty('--observer-test', 'resume');
    await settle();
    expect(resize).toHaveBeenCalledTimes(1);
    expect(font.deliveries).toBeGreaterThan(0);
    expect(font.exhausted, 'target observer exhausted').toBe(false);
  } finally {
    state.pointerSelecting = false;
    session.destroy();
    for (const font of fonts) font.observer.disconnect();
    scroller.remove();
  }
});

it('ignores queued observer deliveries after editor replacement and destruction', async () => {
  const { session, fonts, font, scroller } = await start();
  try {
    const old = font;
    const oldEditor = session.editor!;
    await session.seek(source.indexOf('row99'), false);
    expect(session.editor).not.toBe(oldEditor);
    expect(oldEditor.isDestroyed).toBe(true);
    await settle();
    const resize = vi.spyOn(session, 'resizeTable');
    old.callback([], old.observer);
    expect(resize).not.toHaveBeenCalled();
    const current = fonts.at(-1)!;
    expect(current).not.toBe(old);
    expect(current.target).toBe(session.editor!.view.dom);
    session.destroy();
    current.callback([], current.observer);
    expect(resize).not.toHaveBeenCalled();
  } finally {
    session.destroy();
    for (const font of fonts) font.observer.disconnect();
    scroller.remove();
  }
});
