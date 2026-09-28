import { gzipSync } from 'node:zlib';
import type { Page, TestInfo } from '@playwright/test';
type Frame = { time: number; mounts: number; mounted: number };
type Probe = {
  frames: Frame[];
  longtasks: { start: number; duration: number }[];
  observations: Map<ResizeObserver, Set<Element>>;
};
declare global {
  interface Window {
    rowScaleProbe: Probe;
  }
}

// Install before the production panel creates observers. Count registrations, not
// just distinct elements: two observers of one node are two retained resources.
export async function instrument(page: Page) {
  await page.evaluate(() => {
    const probe: Probe = { frames: [], longtasks: [], observations: new Map() };
    window.rowScaleProbe = probe;
    const Native = window.ResizeObserver;
    window.ResizeObserver = class extends Native {
      observe(node: Element, options?: ResizeObserverOptions) {
        const nodes = probe.observations.get(this) ?? new Set<Element>();
        nodes.add(node);
        probe.observations.set(this, nodes);
        super.observe(node, options);
      }
      unobserve(node: Element) {
        probe.observations.get(this)?.delete(node);
        super.unobserve(node);
      }
      disconnect() {
        probe.observations.delete(this);
        super.disconnect();
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
    const targets = [...window.rowScaleProbe.observations.values()].flatMap((set) => [...set]);
    return {
      label: name,
      time: performance.now(),
      mounted: rows.length,
      visible,
      observed: targets.length,
      detachedObserved: targets.filter((node) => !node.isConnected).length,
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
      categories:
        '-*,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack,blink.user_timing,v8.execute,disabled-by-default-v8.cpu_profiler',
      options: 'sampling-frequency=1000',
      transferMode: 'ReportEvents',
    });
  }
  return async (info: TestInfo) => {
    const after = await cdp.send('Performance.getMetrics');
    if (tracing) {
      const complete = new Promise<void>((resolve) =>
        cdp.once('Tracing.tracingComplete', () => resolve()),
      );
      await cdp.send('Tracing.end');
      await complete;
      await info.attach('path-renderer-timeline.json.gz', {
        body: gzipSync(JSON.stringify({ traceEvents: trace })),
        contentType: 'application/gzip',
      });
    }
    await info.attach('path-performance-metrics', {
      body: JSON.stringify({ before, after }),
      contentType: 'application/json',
    });
    await cdp.detach();
  };
}
