/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OperationalPanelHost from './OperationalPanelHost.svelte';
import type { provideOperationalPanel } from '../operational-panel.svelte';

// eslint-disable-next-line themis/collection-state-shape -- Local test scheduler queues, not Redux state.
const phases = vi.hoisted(() => ({ reads: [] as (() => void)[], writes: [] as (() => void)[] }));
vi.mock('$lib/utils/layout-phases', () => ({
  scheduleLayoutRead: (callback: () => void) => {
    phases.reads.push(callback);
    return vi.fn();
  },
  scheduleLayoutWrite: (callback: () => void) => {
    phases.writes.push(callback);
    return vi.fn();
  },
}));

let panel: ReturnType<typeof provideOperationalPanel>;
const entry = { key: 'same-row', kind: 'tool' as const, estimatedHeight: 28 };
function node(top = 0) {
  const element = document.createElement('div');
  document.body.append(element);
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: top,
    left: 0,
    top,
    right: 600,
    bottom: top + 28,
    width: 600,
    height: 28,
    toJSON: () => ({}),
  });
  return element;
}
function frame() {
  const reads = phases.reads.splice(0);
  reads.forEach((read) => read());
  phases.writes.splice(0).forEach((write) => write());
}
beforeEach(() => {
  phases.reads.length = phases.writes.length = 0;
  render(OperationalPanelHost, { ready: (owner) => (panel = owner) });
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('panel geometry lifetime', () => {
  it('admits spacer-only rows in a zero-width shrink-to-fit container', () => {
    const root = node();
    vi.mocked(root.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 0, 28));
    panel.attach('message', root, [entry], vi.fn());
    frame();
    expect(panel.policy.snapshot().visibleKeys).toEqual([entry.key]);
    expect(panel.policy.snapshot().mountedKeys).toEqual([entry.key]);
  });

  it('returns scroll coordinates in the scrollport units under CSS zoom', () => {
    const scroll = node();
    scroll.style.overflowY = 'auto';
    scroll.scrollTop = 10;
    Object.defineProperty(scroll, 'offsetWidth', { value: 300 });
    const root = node();
    Object.defineProperty(root, 'offsetWidth', { value: 300 });
    scroll.append(root);
    panel.attach('message', root, [entry, { ...entry, key: 'second' }], vi.fn());
    frame();
    expect(panel.locate('second')).toMatchObject({ scrollRoot: scroll, top: 38, height: 28 });
  });

  it('reprojects standalone renderers after an ancestor or document scroll', () => {
    const root = node(2000);
    panel.attach('message', root, [entry], vi.fn());
    frame();
    expect(panel.policy.snapshot().visibleKeys).toEqual([]);
    vi.mocked(root.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 600, 28));
    window.dispatchEvent(new Event('scroll'));
    frame();
    expect(panel.policy.snapshot().visibleKeys).toEqual([entry.key]);
  });

  it('rejects delayed geometry from the previous attachment even for the same key', () => {
    const old = node();
    panel.attach('message', old, [entry], vi.fn());
    phases.reads.shift()!();
    const replacement = node(2000);
    panel.attach('message', replacement, [entry], vi.fn());
    phases.writes.shift()!();
    expect(panel.policy.snapshot().mountedKeys).toEqual([]);
    frame();
    expect(panel.policy.snapshot().visibleKeys).toEqual([]);
  });

  it('does not submit hidden or zero row heights to the positive measurement API', () => {
    const parent = node();
    parent.style.visibility = 'hidden';
    const root = node();
    const row = node();
    parent.append(root);
    root.append(row);
    panel.attach('message', root, [entry], vi.fn());
    panel.watch(row, entry.key);
    const measure = vi.spyOn(panel.policy, 'measure');
    frame();
    expect(measure).toHaveBeenLastCalledWith([]);
    parent.style.visibility = 'visible';
    vi.mocked(row.getBoundingClientRect).mockReturnValue(new DOMRect());
    panel.pin(entry.key, false);
    frame();
    expect(measure).toHaveBeenLastCalledWith([]);
  });
});
