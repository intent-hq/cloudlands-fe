import { gzipSync } from 'node:zlib';
import type { Page, TestInfo } from '@playwright/test';
type Frame = { time: number; mounts: number; mounted: number };
type ObserverTarget = {
  id: number;
  node: WeakRef<Element>;
  registeredAt: string;
};
type ObserverRecord = {
  id: number;
  callbackId: number;
  callbackName: string;
  constructorStack: string;
  createdAt: string;
  targets: Map<number, ObserverTarget>;
  stages: Record<
    string,
    { observe: number; unobserve: number; disconnect: number; callbacks: number }
  >;
  lastCallback?: { stage: string; targets: number[]; detached: number };
};
type Probe = {
  frames: Frame[];
  longtasks: { start: number; duration: number }[];
  observers: Map<number, ObserverRecord>;
  stage: string;
  observerBaseline?: number;
};
declare global {
  interface Window {
    rowScaleProbe: Probe;
  }
}

// Install before production creates observers. Keep only weak DOM references:
// unmatched registrations are bookkeeping evidence, not proof of native retention.
export async function instrument(page: Page) {
  await page.evaluate(() => {
    const probe: Probe = { frames: [], longtasks: [], observers: new Map(), stage: 'setup' };
    window.rowScaleProbe = probe;
    const targetIds = new WeakMap<Element, number>();
    const callbackIds = new WeakMap<ResizeObserverCallback, number>();
    const records = new WeakMap<ResizeObserver, ObserverRecord>();
    let nextTarget = 0;
    let nextCallback = 0;
    const targetId = (node: Element) => {
      let id = targetIds.get(node);
      if (id === undefined) targetIds.set(node, (id = ++nextTarget));
      return id;
    };
    const stage = (record: ObserverRecord) =>
      (record.stages[probe.stage] ??= { observe: 0, unobserve: 0, disconnect: 0, callbacks: 0 });
    const Native = window.ResizeObserver;
    window.ResizeObserver = class extends Native {
      constructor(callback: ResizeObserverCallback) {
        let callbackId = callbackIds.get(callback);
        if (callbackId === undefined) callbackIds.set(callback, (callbackId = ++nextCallback));
        const record: ObserverRecord = {
          id: probe.observers.size + 1,
          callbackId,
          callbackName: callback.name || '(anonymous)',
          constructorStack: new Error('ResizeObserver owner').stack ?? '',
          createdAt: probe.stage,
          targets: new Map(),
          stages: {},
        };
        super(function (this: ResizeObserver, entries, observer) {
          stage(record).callbacks++;
          record.lastCallback = {
            stage: probe.stage,
            targets: entries.map((entry) => targetId(entry.target)),
            detached: entries.filter((entry) => !entry.target.isConnected).length,
          };
          callback.call(this, entries, observer);
        });
        records.set(this, record);
        probe.observers.set(record.id, record);
      }
      observe(node: Element, options?: ResizeObserverOptions) {
        super.observe(node, options);
        const record = records.get(this)!;
        stage(record).observe++;
        const id = targetId(node);
        record.targets.set(id, { id, node: new WeakRef(node), registeredAt: probe.stage });
      }
      unobserve(node: Element) {
        super.unobserve(node);
        const record = records.get(this)!;
        stage(record).unobserve++;
        record.targets.delete(targetId(node));
      }
      disconnect() {
        super.disconnect();
        const record = records.get(this)!;
        stage(record).disconnect++;
        record.targets.clear();
      }
    };
    let mounts = 0;
    const observer = new MutationObserver((records) => {
      const added = new Set<Element>();
      for (const record of records) {
        if (
          record.type === 'attributes' &&
          record.oldValue === null &&
          record.target instanceof Element &&
          record.target.hasAttribute('data-chat-operational-row')
        )
          added.add(record.target);
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('[data-chat-operational-row]')) added.add(node);
          node.querySelectorAll('[data-chat-operational-row]').forEach((row) => added.add(row));
        }
      }
      mounts += added.size;
      if (added.size) performance.mark(`row-mounts:${added.size}`);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-chat-operational-row'],
      attributeOldValue: true,
    });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        probe.longtasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
    const frame = (time: number) => {
      probe.frames.push({
        time,
        mounts,
        mounted: document.querySelectorAll('[data-chat-operational-row]').length,
      });
      mounts = 0;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

export async function frames(page: Page, count = 30) {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
  }, count);
}

export async function snapshot(page: Page, label: string) {
  return page.evaluate((name) => {
    performance.mark(`checkpoint:${name}`);
    const rows = [...document.querySelectorAll('[data-chat-operational-row]')];
    const visible = rows.filter((row) => {
      const summary = row.querySelector('[data-operational-disclosure-row]') ?? row;
      const box = summary.getBoundingClientRect();
      let top = 0,
        bottom = innerHeight;
      for (let ancestor = summary.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (/auto|scroll|hidden|clip/.test(getComputedStyle(ancestor).overflowY)) {
          const clip = ancestor.getBoundingClientRect();
          top = Math.max(top, clip.top);
          bottom = Math.min(bottom, clip.bottom);
        }
      }
      return box.bottom > top && box.top < bottom;
    }).length;
    const records = [...window.rowScaleProbe.observers.values()];
    const targets = records.flatMap((record) =>
      [...record.targets.values()].flatMap((target) => {
        const node = target.node.deref();
        return node ? [node] : [];
      }),
    );
    const observerRecords = records.map(({ targets, ...record }) => ({
      ...record,
      targets: [...targets.values()].map(({ node: ref, ...target }) => {
        const node = ref.deref();
        return {
          ...target,
          connected: node?.isConnected ?? null,
          collected: !node,
          tag: node?.tagName,
          attributes: node
            ? Object.fromEntries([...node.attributes].map((attr) => [attr.name, attr.value]))
            : undefined,
        };
      }),
    }));
    const precedingStage = window.rowScaleProbe.stage;
    window.rowScaleProbe.stage = name;
    window.rowScaleProbe.observerBaseline ??= targets.length;
    return {
      label: name,
      time: performance.now(),
      mounted: rows.length,
      visible,
      observed: targets.length,
      observerRecords,
      precedingStage,
      observerReferencePolicy:
        'weak DOM references; unmatched registrations do not prove native retention',
      unmatchedRegistrations: records.reduce((total, record) => total + record.targets.size, 0),
      observerBaseline: window.rowScaleProbe.observerBaseline,
      observerDelta: targets.length - window.rowScaleProbe.observerBaseline,
      detachedObserved: targets.filter((node) => !node.isConnected).length,
      detachedTargets: targets
        .filter((node) => !node.isConnected)
        .map((node) => ({
          tag: node.tagName,
          attributes: Object.fromEntries(
            [...node.attributes]
              .filter((attribute) => attribute.name.startsWith('data-'))
              .map((attribute) => [attribute.name, attribute.value]),
          ),
        })),
      rowObserved: targets.filter((node) => node.matches('[data-operational-window-key]')).length,
      windowObserved: targets.filter((node) => node.matches('[data-operational-window]')).length,
    };
  }, label);
}

export async function timeline(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = await cdp.send('Performance.getMetrics');
  const trace: unknown[] = [];
  const tracing = process.env.ROW_PERF_TRACE === '1';
  if (tracing) {
    cdp.on('Tracing.dataCollected', ({ value }) => trace.push(...value));
    await cdp.send('Tracing.start', {
      // The synthetic renderer matrix supplies sampled CPU attribution. Keep
      // full-panel traces lighter so source/search work cannot fill the buffer
      // before the last checkpoint. Assert the trace endpoints below.
      traceConfig: {
        recordMode: 'recordAsMuchAsPossible',
        traceBufferSizeInKb: 131072,
        excludedCategories: ['*'],
        includedCategories: [
          'devtools.timeline',
          'disabled-by-default-devtools.timeline',
          'disabled-by-default-devtools.timeline.stack',
          'blink.user_timing',
          ...(process.env.ROW_PERF_CPU === '1'
            ? ['v8.execute', 'disabled-by-default-v8.cpu_profiler']
            : []),
        ],
      },
      transferMode: 'ReportEvents',
    });
    await page.evaluate(() => performance.mark('trace:path-start'));
  }
  return async (info: TestInfo, checkpoints: string[]) => {
    const after = await cdp.send('Performance.getMetrics');
    if (tracing) {
      await page.evaluate(() => performance.mark('trace:path-end'));
      const complete = new Promise<void>((resolve) =>
        cdp.once('Tracing.tracingComplete', () => resolve()),
      );
      await cdp.send('Tracing.end');
      await complete;
      await info.attach('path-renderer-timeline.json.gz', {
        body: gzipSync(JSON.stringify({ traceEvents: trace })),
        contentType: 'application/gzip',
      });
      const names = new Set(trace.map((event) => (event as { name: string }).name));
      if (
        [
          'trace:path-start',
          'trace:path-end',
          ...checkpoints.map((name) => `checkpoint:${name}`),
        ].some((name) => !names.has(name))
      ) {
        throw new Error('Incomplete path timeline; do not report its durations as full coverage');
      }
    }
    await info.attach('path-performance-metrics', {
      body: JSON.stringify({ before, after }),
      contentType: 'application/json',
    });
    await cdp.detach();
  };
}
