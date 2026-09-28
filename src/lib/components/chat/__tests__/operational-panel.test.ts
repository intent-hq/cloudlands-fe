/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OperationalPanelHost from './OperationalPanelHost.svelte';
import type { AgentMessage } from '$shared/types';
import { groupContentBlocks } from '$lib/utils/messageParser';
import { normalizeResponseGroups } from '../response-group-blocks';
import { createWindowItemProjector } from '../operational-window-items';
import { findChatSearchMatches } from '../chat-search';
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
  Reflect.deleteProperty(document, 'scrollingElement');
  document.documentElement.scrollTop = 0;
});

describe('panel scope work', () => {
  function addScopes(count: number) {
    return Array.from({ length: count }, (_, index) =>
      panel.attach(
        `message${index}`,
        node(),
        Array.from({ length: 4 }, (_, row) => ({
          key: `message${index}:row${row}`,
          kind: 'tool' as const,
          estimatedHeight: 28,
          navigation: { messageId: `message${index}`, path: `b:${row}` },
        })),
        vi.fn(),
      ),
    );
  }

  it('bounds full-panel descriptor work across a batch of new message scopes', () => {
    const rebuild = vi.spyOn(panel.policy, 'setEntries');
    const snapshots = vi.spyOn(panel.policy, 'snapshot');
    const scopeCount = 80;
    addScopes(scopeCount);
    // Initial spacers and navigation are available synchronously, but the
    // descriptor collection must not be copied once for every new message.
    expect(panel.resolveTarget('message79', 'b:3')).toBe('message79:row3');
    expect(rebuild.mock.calls.reduce((work, [rows]) => work + rows.length, 0)).toBeLessThanOrEqual(
      scopeCount * 4 * 2,
    );
    expect(snapshots.mock.calls.length).toBeLessThanOrEqual(2);
    frame();
    expect(rebuild.mock.calls.reduce((work, [rows]) => work + rows.length, 0)).toBeLessThanOrEqual(
      scopeCount * 4 * 2,
    );
    expect(panel.policy.snapshot().mountedKeys.length).toBeLessThanOrEqual(4);
  });

  it('bounds descriptor work when all message scopes are removed together', () => {
    const remove = addScopes(80);
    frame();
    const rebuild = vi.spyOn(panel.policy, 'setEntries');
    const snapshots = vi.spyOn(panel.policy, 'snapshot');
    for (const detach of remove) detach();
    expect(panel.resolveTarget('message79', 'b:3')).toBeUndefined();
    expect(rebuild.mock.calls.reduce((work, [rows]) => work + rows.length, 0)).toBeLessThanOrEqual(
      320,
    );
    expect(snapshots.mock.calls.length).toBeLessThanOrEqual(2);
    frame();
    expect(panel.policy.snapshot().mountedKeys).toEqual([]);
  });

  it('updates navigation metadata without visiting unchanged message descriptors', () => {
    const unrelatedNavigation = vi.fn(() => ({ messageId: 'other', path: 'b:0' }));
    const other = {
      ...entry,
      key: 'other',
      get navigation() {
        return unrelatedNavigation();
      },
    };
    panel.attach('other', node(), [other], vi.fn());
    panel.attach(
      'changed',
      node(),
      [{ ...entry, navigation: { messageId: 'changed', path: 'b:0' } }],
      vi.fn(),
    );
    unrelatedNavigation.mockClear();
    panel.update('changed', [{ ...entry, navigation: { messageId: 'changed', path: 'b:1' } }]);
    expect(panel.resolveTarget('changed', 'b:0')).toBeUndefined();
    expect(panel.resolveTarget('changed', 'b:1')).toBe(entry.key);
    expect(panel.resolveTarget('other', 'b:0')).toBe('other');
    expect(unrelatedNavigation).not.toHaveBeenCalled();
  });

  it('keeps source fragment order when another scope metadata changes', () => {
    const first = {
      ...entry,
      key: 'first',
      navigation: { messageId: 'same', path: 'b:0', text: 'Needle' },
    };
    const second = {
      ...entry,
      key: 'second',
      navigation: { messageId: 'same', path: 'b:0', text: 'Needle Needle' },
    };
    panel.attach('first', node(), [first], vi.fn());
    panel.attach('second', node(), [second], vi.fn());
    panel.update('first', [
      { ...first, navigation: { ...first.navigation, text: 'Updated Needle' } },
    ]);
    expect(panel.resolveTarget('same', 'b:0')).toBe('first');
    expect(panel.resolveMatch('same', 'b:0', ' needle ', 2)).toEqual({
      key: 'second',
      occurrenceInRow: 1,
    });
  });

  it('moves target ownership without exposing the old scope element or deleting the replacement', () => {
    const first = node();
    const removeFirst = panel.attach(
      'first',
      first,
      [{ ...entry, navigation: { messageId: 'm', path: 'b:0' } }],
      vi.fn(),
    );
    const oldRow = node();
    first.append(oldRow);
    panel.watch(oldRow, entry.key);
    panel.attach('second', node(), [{ ...entry, key: 'other' }], vi.fn());
    frame();
    panel.update('second', [{ ...entry, navigation: { messageId: 'm', path: 'b:1' } }]);
    expect(panel.resolveTarget('m', 'b:0')).toBeUndefined();
    expect(panel.resolveTarget('m', 'b:1')).toBe(entry.key);
    expect(panel.locate(entry.key)?.node).toBeUndefined();
    expect(panel.locate(entry.key)?.admitted).toBe(false);
    removeFirst();
    expect(panel.resolveTarget('m', 'b:1')).toBe(entry.key);
  });

  it('invalidates a replacement immediately and ignores old cleanup before the batched rebuild', () => {
    const old = node();
    const removeOld = panel.attach('same', old, [entry], vi.fn());
    frame();
    expect(panel.policy.snapshot().mountedKeys).toContain(entry.key);
    const replacement = node();
    const notify = vi.fn();
    panel.attach(
      'same',
      replacement,
      [{ ...entry, navigation: { messageId: 'same', path: 'b:1' } }],
      notify,
    );
    removeOld();
    expect(panel.policy.snapshot().mountedKeys).not.toContain(entry.key);
    expect(panel.resolveTarget('same', 'b:1')).toBe(entry.key);
    expect(notify.mock.lastCall?.[0]).toEqual([
      expect.objectContaining({ type: 'spacer', admitted: false }),
    ]);
    frame();
    expect(panel.resolveTarget('same', 'b:1')).toBe(entry.key);
  });
});

describe('panel geometry lifetime', () => {
  it('maps a trimmed catalog query to the real emitted reasoning fragment', () => {
    const message: AgentMessage = {
      id: 'message',
      role: 'assistant',
      timestamp: '2026-09-28T10:00:00Z',
      contentBlocks: [
        { type: 'text', text: '<group:Prepping>Visible description.' },
        {
          type: 'thinking',
          id: 'history',
          text: Array.from({ length: 100 }, (_, i) => `**Reasoning target-${i}-end**`).join('\n\n'),
        },
        { type: 'text', text: '</group:Prepping>' },
      ],
    };
    const groups = normalizeResponseGroups(
      groupContentBlocks(message.contentBlocks!, false),
      false,
    );
    const group = groups[0];
    if (group.type !== 'content_group') throw new Error('Expected a real parsed reasoning group');
    const rows = createWindowItemProjector()(group.children, message.id, () => true, group);
    panel.attach('message', node(), rows, vi.fn());
    const expected = rows.find((row) => row.navigation.text?.includes('Reasoning target-90-end'));
    expect(expected).toBeDefined();
    for (const query of ['Reasoning target-90-end', ' Reasoning target-90-end ']) {
      const [match] = findChatSearchMatches([message], query, new Map([[message.id, 'turn']]));
      expect(match).toBeDefined();
      expect(
        panel.resolveMatch(message.id, match.blockPath, query, match.occurrenceInBlock),
      ).toEqual({ key: expected!.key, occurrenceInRow: 0 });
    }
  });

  it('maps repeated block matches to the correct emitted fragment and local occurrence', () => {
    const entries = ['needle', 'other', 'needle needle'].map((text, index) => ({
      ...entry,
      key: `fragment-${index}`,
      navigation: { messageId: 'message', path: 'b:0:c:1', text },
    }));
    panel.attach('message', node(), entries, vi.fn());
    expect(panel.resolveMatch('message', 'b:0:c:1', 'needle', 0)).toEqual({
      key: 'fragment-0',
      occurrenceInRow: 0,
    });
    expect(panel.resolveMatch('message', 'b:0:c:1', 'NEEDLE', 1)).toEqual({
      key: 'fragment-2',
      occurrenceInRow: 0,
    });
    expect(panel.resolveMatch('message', 'b:0:c:1', 'needle', 2)).toEqual({
      key: 'fragment-2',
      occurrenceInRow: 1,
    });
    expect(panel.resolveMatch('message', 'b:0:c:1', 'absent', 0)).toBeUndefined();
  });

  it('resolves current source paths to canonical rows without synchronous geometry reads', () => {
    const root = node();
    const original = { ...entry, navigation: { messageId: 'message', path: 'b:2' } };
    panel.attach('message', root, [original], vi.fn());
    frame();
    vi.mocked(root.getBoundingClientRect).mockClear();
    expect(panel.resolveTarget('message', 'b:2')).toBe(entry.key);
    expect(panel.resolveTarget('other-message', 'b:2')).toBeUndefined();
    panel.update('message', [{ ...original, navigation: { messageId: 'message', path: 'b:3' } }]);
    expect(panel.resolveTarget('message', 'b:2')).toBeUndefined();
    expect(panel.resolveTarget('message', 'b:3')).toBe(entry.key);
    expect(root.getBoundingClientRect).not.toHaveBeenCalled();
  });

  it('does not let a cancelled navigation release a newer lease on the same row', () => {
    panel.attach('message', node(2000), [entry], vi.fn());
    frame();
    const first = {};
    const second = {};
    panel.pin(entry.key, true, first);
    panel.pin(entry.key, true, second);
    panel.pin(entry.key, false, first);
    expect(panel.policy.snapshot().pinnedKeys).toEqual([entry.key]);
    panel.pin(entry.key, false, second);
    expect(panel.policy.snapshot().pinnedKeys).toEqual([]);
  });

  it('releases the focus pin when its row is destroyed without a blur event', () => {
    panel.attach('message', node(2000), [entry], vi.fn());
    frame();
    const row = node();
    row.tabIndex = 0;
    const watch = panel.watch(row, entry.key);
    row.focus();
    expect(panel.policy.snapshot().pinnedKeys).toEqual([entry.key]);
    watch.destroy();
    row.remove();
    expect(panel.policy.snapshot().pinnedKeys).toEqual([]);
  });

  it('keeps focus retained when a navigation pin on the same row is released', () => {
    panel.attach('message', node(2000), [entry], vi.fn());
    frame();
    const row = node();
    row.tabIndex = 0;
    panel.watch(row, entry.key);
    row.focus();
    panel.pin(entry.key, true);
    panel.pin(entry.key, false);
    expect(panel.policy.snapshot().pinnedKeys).toEqual([entry.key]);
  });

  it('does not admit rows through a zero-width horizontal clipping ancestor', () => {
    const clip = node();
    clip.style.overflowX = 'hidden';
    vi.mocked(clip.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 0, 800));
    const root = node();
    clip.append(root);
    panel.attach(
      'message',
      root,
      Array.from({ length: 40 }, (_, index) => ({ ...entry, key: `row${index}` })),
      vi.fn(),
    );
    frame();
    expect(panel.policy.snapshot().visibleKeys).toEqual([]);
    expect(panel.policy.snapshot().mountedKeys).toEqual([]);
  });

  it('ignores an old row blur after a same-key replacement takes focus', async () => {
    const root = node(2000);
    panel.attach('message', root, [entry], vi.fn());
    frame();
    const old = node();
    old.tabIndex = 0;
    const watch = panel.watch(old, entry.key);
    old.focus();
    old.dispatchEvent(new FocusEvent('focusout'));
    watch.destroy();
    old.remove();
    const replacement = node();
    replacement.tabIndex = 0;
    panel.watch(replacement, entry.key);
    replacement.focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(replacement);
    expect(panel.policy.snapshot().pinnedKeys).toEqual([entry.key]);
  });

  for (const zoom of [1, 2]) {
    it(`locates and restores document scroll anchors at zoom ${zoom}`, () => {
      const scroll = document.documentElement;
      const offset = vi.spyOn(scroll, 'offsetWidth', 'get').mockReturnValue(600);
      vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, -500 * zoom, 600 * zoom, 4000),
      );
      Object.defineProperty(document, 'scrollingElement', { configurable: true, value: scroll });
      scroll.scrollTop = 500;
      const root = node(100);
      vi.spyOn(root, 'offsetWidth', 'get').mockReturnValue(600 / zoom);
      const row = node(100);
      root.append(row);
      panel.attach('message', root, [entry], vi.fn());
      panel.watch(row, entry.key);
      frame();
      expect(panel.locate(entry.key)).toMatchObject({ scrollRoot: scroll, top: 500 + 100 / zoom });
      vi.mocked(root.getBoundingClientRect).mockReturnValue(new DOMRect(0, 140, 600, 28));
      vi.mocked(row.getBoundingClientRect).mockReturnValue(new DOMRect(0, 140, 600, 28));
      window.dispatchEvent(new Event('resize'));
      frame();
      expect(scroll.scrollTop).toBe(500 + 40 / zoom);
      offset.mockRestore();
    });
  }

  it('admits spacer-only rows in a zero-width shrink-to-fit container', () => {
    const root = node();
    vi.mocked(root.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 0, 28));
    panel.attach('message', root, [entry], vi.fn());
    frame();
    expect(panel.policy.snapshot().visibleKeys).toEqual([entry.key]);
    expect(panel.policy.snapshot().mountedKeys).toEqual([entry.key]);
  });

  it('locates rows through a non-scrolling auto-overflow wrapper', () => {
    const scroll = node();
    scroll.style.overflowY = 'auto';
    vi.spyOn(scroll, 'clientHeight', 'get').mockReturnValue(300);
    vi.spyOn(scroll, 'scrollHeight', 'get').mockReturnValue(3000);
    const wrapper = node();
    wrapper.style.overflowY = 'auto';
    vi.spyOn(wrapper, 'clientHeight', 'get').mockReturnValue(2800);
    vi.spyOn(wrapper, 'scrollHeight', 'get').mockReturnValue(2800);
    scroll.append(wrapper);
    const root = node();
    wrapper.append(root);
    panel.attach('message', root, [entry], vi.fn());
    frame();
    expect(panel.locate(entry.key)?.scrollRoot).toBe(scroll);
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
