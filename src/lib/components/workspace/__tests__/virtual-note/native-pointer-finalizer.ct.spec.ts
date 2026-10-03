import { test, expect } from '../../../../../test/ct-test';
import Harness from './NativePointerProbeHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';
import { installPointerProbe } from './native-pointer-probe';
const prefix = 'plain café 🌍\n\n- parent\n  - child\n\n```text\nfenced café 🌍\n```\n\n';
const source =
  prefix +
  '| H | R |\n| --- | --- |\n' +
  Array.from({ length: 800 }, (_, i) => `| cell-${i} café 🌍 | repeated |\n`).join('') +
  '\nfollowing café 🌍 repeated';

const variants = [
  { name: 'native-post-release-newer', paired: false, reverse: false, full: true, turn: false },
  ...[false, true].map((mutations) => ({
    name: `native-deferred-${mutations ? 'ignored-root-records' : 'selection'}`,
    paired: false,
    reverse: false,
    full: true,
    turn: false,
  })),
  { name: 'native-full-no-added-wait', paired: false, reverse: false, full: true, turn: false },
  {
    name: 'native-full-zero-delay-timer-barrier',
    paired: false,
    reverse: false,
    full: true,
    turn: true,
  },
  { name: 'native-minimal-no-added-wait', paired: false, reverse: false, full: false, turn: false },
  ...[false, true].flatMap((reverse) =>
    [false, true].map((turn) => ({
      name: `paired-${reverse ? 'bounded-first' : 'native-first'}-${turn ? 'zero-delay-timer-barrier' : 'no-added-wait'}`,
      paired: true,
      reverse,
      full: true,
      turn,
    })),
  ),
];
for (const edge of ['before', 'after'] as const)
  for (const backward of [false, true])
    for (const variant of variants) {
      if (
        (variant.paired ||
          variant.name.startsWith('native-deferred') ||
          variant.name === 'native-post-release-newer') &&
        (edge !== 'after' || backward)
      )
        continue;
      const cellOrigin = edge === 'before' ? backward : !backward;
      if (!cellOrigin && (variant.turn || !variant.full)) continue;
      test(`native finalizer ${edge} ${backward ? 'backward' : 'forward'} ${variant.name}`, async ({
        mount,
        page,
      }, info) => {
        await mount(Harness, { props: { sourceOverride: source, paired: variant.paired } });
        if (variant.paired) {
          await focus(page, 'bounded');
          await page
            .getByTestId('bounded')
            .getByTestId('proof')
            .evaluate(
              async (el, at) => {
                await (el as Host).proof.seek(at);
              },
              edge === 'before' ? 0 : source.length - 1,
            );
        }
        const order = variant.paired
          ? variant.reverse
            ? ['bounded', 'native']
            : ['native', 'bounded']
          : ['native'];
        const gesture = 'pointer';
        for (const side of order) {
          await focus(page, side);
          const endpoints = await page
            .getByTestId(side)
            .getByTestId('proof')
            .evaluate(
              (el, { edge, backward, gesture }) => {
                const h = el as Host,
                  e = h.proof?.editor ?? h.native;
                const roots: Array<{ pos: number; node: typeof e.state.doc }> = [];
                e.state.doc.forEach((node, pos) => roots.push({ node, pos }));
                const table = roots.findIndex((r) => r.node.type.name === 'table');
                const a = roots[edge === 'before' ? table - 1 : table],
                  b = roots[edge === 'before' ? table : table + 1];
                let left = -1,
                  right = -1;
                if (a.node.isTextblock) left = a.pos + a.node.nodeSize - 1;
                else
                  a.node.descendants((node, pos) => {
                    if (node.isTextblock) left = a.pos + 1 + pos + node.nodeSize - 1;
                  });
                if (b.node.isTextblock) right = b.pos + 1;
                else
                  b.node.descendants((node, pos) => {
                    if (node.isTextblock && right < 0) right = b.pos + 2 + pos;
                  });
                const first =
                    gesture === 'shift'
                      ? backward
                        ? right
                        : left
                      : backward
                        ? right + 1
                        : left - 1,
                  last = backward ? left - 1 : right + 1;
                e.chain().setTextSelection(first).scrollIntoView().run();
                return { first, last };
              },
              { edge, backward, gesture },
            );

          await settled(page);
          const root = page.getByTestId(side).getByTestId('proof');
          const modelBefore = await root.evaluate((el) => {
            const h = el as Host;
            return JSON.stringify((h.proof?.editor ?? h.native).getJSON());
          });
          await root.evaluate(installPointerProbe, {
            full: variant.full,
            nativeFinalizer: true,
            postReleaseNewerSelection: variant.name === 'native-post-release-newer',
            deferAtStop: variant.name.startsWith('native-deferred'),
            deferredMutations: variant.name.endsWith('ignored-root-records'),
          });
          let gestureError: unknown;
          try {
            const coords = await page
              .getByTestId(side)
              .getByTestId('proof')
              .evaluate((el, p) => {
                const h = el as Host,
                  e = h.proof?.editor ?? h.native,
                  scroller = e.view.dom.parentElement!.parentElement!;
                const a = e.view.coordsAtPos(p.first),
                  b = e.view.coordsAtPos(p.last);
                scroller.scrollTop +=
                  (Math.min(a.top, b.top) + Math.max(a.bottom, b.bottom)) / 2 -
                  (scroller.getBoundingClientRect().top + scroller.clientHeight / 2);
                const point = (at: number) => {
                  const r = e.view.coordsAtPos(at);
                  return { x: r.left, y: (r.top + r.bottom) / 2 };
                };
                return { first: point(p.first), last: point(p.last) };
              }, endpoints);

            const hits = await root.evaluate((el, coords) => {
              const h = el as Host,
                e = h.proof?.editor ?? h.native;
              const hit = (p: { x: number; y: number }) => {
                const node = document.elementFromPoint(p.x, p.y);
                return {
                  tag: node?.tagName,
                  text: node?.textContent?.slice(0, 80),
                  at: e.view.posAtCoords({ left: p.x, top: p.y }),
                  focused: e.view.hasFocus(),
                };
              };
              return { first: hit(coords.first), last: hit(coords.last) };
            }, coords);
            await info.attach('probe-geometry-' + side + '.json', {
              body: JSON.stringify({ variant, edge, backward, endpoints, coords, hits }),
              contentType: 'application/json',
            });
            await page.mouse.move(coords.first.x, coords.first.y);
            await page.mouse.down();
            await page.mouse.move(coords.last.x, coords.last.y, { steps: 8 });
            if (variant.turn)
              await root.evaluate(async (el) => {
                const probe = (
                  el as unknown as { pointerProbe: { record: (kind: string) => void } }
                ).pointerProbe;
                probe.record('zero-delay-timer-barrier-scheduled');
                await new Promise<void>((resolve) =>
                  setTimeout(() => {
                    probe.record('zero-delay-timer-barrier');
                    resolve();
                  }, 0),
                );
              });
            await page.mouse.up();
            if (variant.full)
              await expect
                .poll(() =>
                  root.evaluate((el) =>
                    (
                      el as unknown as { pointerProbe: { pendingTimers: () => number[] } }
                    ).pointerProbe.pendingTimers(),
                  ),
                )
                .toEqual([]);
            await settled(page);
            await root.evaluate((el) => {
              const h = el as unknown as { pointerProbe: { record: (kind: string) => void } };
              h.pointerProbe.record('settled-after-release');
            });
          } catch (error) {
            gestureError = error;
          } finally {
            const data = await root.evaluate((el) => {
              const h = el as Host & {
                  pointerProbe: {
                    trace: unknown[];
                    record: (kind: string) => void;
                    cleanup: () => void;
                  };
                },
                e = h.proof?.editor ?? h.native;
              h.pointerProbe.record('final');
              let cleanupError = '';
              try {
                h.pointerProbe.cleanup();
              } catch (error) {
                cleanupError = String(error);
              }
              const raw = window.getSelection();
              const inside =
                !!raw?.anchorNode &&
                !!raw.focusNode &&
                e.view.dom.contains(raw.anchorNode) &&
                e.view.dom.contains(raw.focusNode);
              const dom = inside
                ? {
                    anchor: e.view.posAtDOM(raw!.anchorNode!, raw!.anchorOffset),
                    head: e.view.posAtDOM(raw!.focusNode!, raw!.focusOffset),
                  }
                : null;
              return {
                focused: e.view.hasFocus(),
                inside,
                dom,
                pm: { anchor: e.state.selection.anchor, head: e.state.selection.head },
                cleanupError,
                model: JSON.stringify(e.getJSON()),
                trace: h.pointerProbe.trace,
                selection: e.state.selection.toJSON(),
                error: h.proof?.error ?? '',
                sourceUnchanged: h.proof ? h.proof.service.region(0) : undefined,
              };
            });
            await info.attach('native-pointer-internals-' + side + '.json', {
              body: JSON.stringify({
                ...data,
                gestureError: gestureError ? String(gestureError) : '',
              }),
              contentType: 'application/json',
            });
            if (gestureError) throw gestureError;
            expect(data.error).toBe('');
            expect(data.focused).toBe(true);
            expect(data.inside).toBe(true);
            expect(data.dom).toEqual(data.pm);
            expect(data.cleanupError).toBe('');
            expect(data.model).toBe(modelBefore);
            expect(data.trace.length).toBeLessThan(4096);
            if (variant.full) {
              const events = data.trace as Array<{
                kind: string;
                sequence: number;
                documentId: number;
                focused: boolean;
                history: { done?: number; undone?: number; error?: string };
                model: Record<string, unknown>;
                observer: { flushingSoon: number };
                owner: { value: number | null };
                mouse: { delayedSelectionSync: boolean } | null;
                detail?: {
                  type?: string;
                  history?: { done?: number; undone?: number };
                  observerThis?: boolean;
                  count?: number;
                  ignoredRootAttributes?: number;
                  id?: number;
                  timer?: number;
                  source?: string;
                  cellMeta?: { value: number | null };
                };
              }>;
              if (variant.name === 'native-post-release-newer') {
                const entries = events.filter(
                  (e) => e.kind === 'post-release-newer-selection-entry',
                );
                const exits = events.filter((e) => e.kind === 'post-release-newer-selection-exit');
                expect(entries).toHaveLength(1);
                expect(exits).toHaveLength(1);
                expect(
                  events.filter((e) => e.kind === 'post-release-newer-selection-error'),
                ).toHaveLength(0);
                const before = entries[0];
                const after = exits[0];
                expect(before).toBeDefined();
                expect(after).toBeDefined();
                expect(before!.owner.value).toBeNull();
                expect(before!.mouse).toBeNull();
                expect(before!.focused).toBe(true);
                expect(after!.focused).toBe(true);
                expect(after!.model).toEqual({ type: 'text', anchor: 1, head: 1 });
                expect(data.selection).toEqual(after!.model);
                expect(after!.documentId).toBe(before!.documentId);
                expect(before!.detail?.history?.done).toBeDefined();
                expect(before!.detail?.history?.undone).toBeDefined();
                expect(after!.detail?.history).toEqual(before!.detail?.history);
                const release = events.find(
                  (e) => e.kind === 'root-listener-exit' && e.detail?.type === 'mouseup',
                );
                expect(release).toBeDefined();
                expect(release!.sequence).toBeLessThan(before!.sequence);
                const timer = before.detail?.timer;
                expect(timer).toBeDefined();
                expect(after.detail?.timer).toBe(timer);
                const timerEvent = (kind: string) => {
                  const events = events.filter((e) => e.kind === kind && e.detail?.timer === timer);
                  expect(events).toHaveLength(1);
                  return events[0];
                };
                const scheduled = timerEvent('done-timer-schedule');
                expect(scheduled.detail?.source).toContain('selectionToDOM');
                const timerEntry = timerEvent('done-timer-entry');
                const handlerEntry = timerEvent('done-handler-entry');
                const handlerExit = timerEvent('done-handler-exit');
                const timerExit = timerEvent('done-timer-exit');
                expect(scheduled.sequence).toBeLessThan(timerEntry.sequence);
                expect(timerEntry.sequence).toBeLessThan(before.sequence);
                expect(before.sequence).toBeLessThan(after.sequence);
                expect(after.sequence).toBeLessThan(handlerEntry.sequence);
                expect(handlerEntry.sequence).toBeLessThan(handlerExit.sequence);
                expect(handlerExit.sequence).toBeLessThan(timerExit.sequence);
                expect(timerExit).toBeDefined();
                expect(timerExit!.model).toEqual(after!.model);
                expect(timerExit.history).toEqual(before.history);
                const final = events.find((e) => e.kind === 'final')!;
                expect(timerExit.sequence).toBeLessThan(final.sequence);
                expect(final.history).toEqual(before.history);
                expect(before.history?.error).toBeUndefined();
              }
              expect(events.some((event) => event.kind === 'flush-entry')).toBe(true);
              if (events.some((event) => event.owner.value !== null)) {
                const adds = events.filter((event) => event.kind === 'root-listener-add');
                const stop = adds.find(
                  (event) =>
                    event.detail?.type === 'mouseup' &&
                    adds.some(
                      (other) =>
                        other.detail?.type === 'dragstart' && other.detail.id === event.detail?.id,
                    ),
                );
                expect(stop).toBeDefined();
                expect(
                  events.filter(
                    (event) =>
                      event.kind === 'root-listener-entry' && event.detail?.id === stop!.detail?.id,
                  ),
                ).toHaveLength(1);
                const entry = events.findIndex(
                  (event) =>
                    event.kind === 'root-listener-entry' && event.detail?.id === stop!.detail?.id,
                );
                const exits = events.flatMap((event, index) =>
                  event.kind === 'root-listener-exit' && event.detail?.id === stop!.detail?.id
                    ? [index]
                    : [],
                );
                expect(exits).toHaveLength(1);
                const clear = events.findIndex(
                  (event) =>
                    event.kind === 'dispatch-entry' && event.detail?.cellMeta?.value === -1,
                );
                expect(entry).toBeLessThan(clear);
                expect(clear).toBeLessThan(exits[0]);
                expect(events[exits[0]].owner.value).toBeNull();
                if (events[entry].model.type === 'cell') {
                  if (variant.name !== 'native-post-release-newer')
                    expect(data.selection).toEqual(events[entry].model);
                  if (variant.name.startsWith('native-deferred')) {
                    const setup = events.findIndex(
                      (e) => e.kind === 'diagnostic-deferred-setup-exit',
                    );
                    const force = events.findIndex(
                      (e, i) => i > setup && i < clear && e.kind === 'native-force-flush-entry',
                    );
                    const flush = events.findIndex((e, i) => i > force && e.kind === 'flush-entry');
                    const reads = events.filter(
                      (e, i) => i > flush && i < clear && e.kind === 'pendingRecords-return',
                    );
                    expect(events[setup].observer.flushingSoon).toBeGreaterThan(-1);
                    expect(entry).toBeLessThan(setup);
                    expect(setup).toBeLessThan(force);
                    const removals = events.filter(
                      (e, i) => i > setup && i < force && e.kind === 'root-listener-remove',
                    );
                    expect(removals.map((e) => e.detail?.type).sort()).toEqual([
                      'dragstart',
                      'mousemove',
                      'mouseup',
                    ]);
                    const forceExit = events.findIndex(
                      (e, i) => i > force && i < clear && e.kind === 'native-force-flush-exit',
                    );
                    expect(force).toBeLessThan(forceExit);
                    expect(forceExit).toBeLessThan(clear);
                    expect(force).toBeLessThan(flush);
                    expect(flush).toBeLessThan(clear);
                    expect(events[flush].detail?.observerThis).toBe(true);
                    expect(events[flush].owner.value).not.toBeNull();
                    expect(reads.length).toBeGreaterThan(0);
                    expect(events[clear].observer.flushingSoon).toBe(-1);
                    expect(
                      events.filter((e) => e.kind === 'observer-timer-cancel-exit'),
                    ).toHaveLength(1);
                    expect(events.filter((e) => e.kind === 'observer-timer-entry')).toHaveLength(0);
                    if (variant.name.endsWith('ignored-root-records'))
                      expect(
                        reads.reduce((n, e) => n + (e.detail?.ignoredRootAttributes ?? 0), 0),
                      ).toBeGreaterThan(0);
                  }
                }
                expect(
                  events.filter(
                    (event) =>
                      event.kind === 'dispatch-entry' && event.detail?.cellMeta?.value === -1,
                  ),
                ).toHaveLength(1);
                expect(events.at(-1)!.owner.value).toBeNull();
              }
              if (
                events.some(
                  (event) =>
                    event.kind === 'mouseDown.done-entry' && event.mouse?.delayedSelectionSync,
                )
              ) {
                const timers = events.filter((event) => event.kind === 'done-timer-schedule');
                expect(timers.length).toBeGreaterThan(0);
                const final = events.findIndex((event) => event.kind === 'final');
                for (const timer of timers) {
                  expect(timer.detail?.source).toBeTruthy();
                  const entries = events.flatMap((event, index) =>
                    event.kind === 'done-timer-entry' && event.detail?.timer === timer.detail?.timer
                      ? [index]
                      : [],
                  );
                  const exits = events.flatMap((event, index) =>
                    event.kind === 'done-timer-exit' && event.detail?.timer === timer.detail?.timer
                      ? [index]
                      : [],
                  );
                  expect(entries).toHaveLength(1);
                  expect(exits).toHaveLength(1);
                  expect(entries[0]).toBeLessThan(exits[0]);
                  expect(exits[0]).toBeLessThan(final);
                }
              }
            }
            if (side === 'bounded') expect(data.sourceUnchanged).toBe(source);
          }
        }
      });
    }
