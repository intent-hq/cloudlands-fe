import { gzipSync } from 'node:zlib';
import { expect, test } from '../../../../test/ct-test';
import OperationalRowWindowHost from './OperationalRowWindowHost.svelte';
import { instrument, frames, snapshot } from './operational-row-scale-probe';

test.use({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
test.setTimeout(120_000);

// Dataset axes represent distinct bypass risks: one huge message versus many
// simultaneously admitted parent messages, through each production renderer.
for (const renderer of ['streaming', 'settled'] as const) {
  for (const shape of ['single', 'many'] as const) {
    for (const rows of [100, 1000, 5000]) {
      test(`${renderer} ${shape} ${rows}: physical mounts and observers stay bounded`, async ({
        mount,
        page,
      }, info) => {
        await instrument(page);
        const messages = shape === 'single' ? 1 : rows / 10;
        const count = rows / messages / 2; // Each source block emits two reasoning rows.
        const props = { renderer, messages, count, shown: false };
        const host = await mount(OperationalRowWindowHost, { props });
        await frames(page, 2);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Performance.enable');
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
        const metricsBefore = await cdp.send('Performance.getMetrics');
        const samples = [await snapshot(page, 'before-open')];
        try {
          await host.update({ props: { ...props, shown: true } });
          await expect(host.getByText('Inspecting 0', { exact: true }).first()).toBeVisible();
          await frames(page);
          samples.push(await snapshot(page, 'opened'));
          for (let cycle = 0; cycle < 3; cycle++) {
            // Rapid reversals include movements faster than row hydration.
            await host.evaluate(async (node) => {
              for (const fraction of [1, 0.2, 0.8, 0, 1]) {
                node.scrollTop = fraction * node.scrollHeight;
                await new Promise(requestAnimationFrame);
              }
            });
            await expect(
              host
                .locator(`[data-operational-window="m${messages - 1}"]`)
                .getByText(`Checking ${count - 1}`, { exact: true }),
            ).toBeVisible();
            await frames(page);
            samples.push(await snapshot(page, `bottom-${cycle}`));
            await host.evaluate((node) => {
              node.scrollTop = 0;
            });
            await expect(host.getByText('Inspecting 0', { exact: true }).first()).toBeVisible();
            await frames(page);
            samples.push(await snapshot(page, `top-${cycle}`));
          }
          for (const sample of samples.slice(1)) {
            expect(sample.mounted, sample.label).toBeGreaterThan(0);
            expect(sample.mounted - sample.visible, sample.label).toBeLessThanOrEqual(24);
            expect(sample.detachedObserved, sample.label).toBe(0);
          }
          // Revisiting identical geometry must not accumulate retained observations.
          const tops = samples.filter((sample) => sample.label.startsWith('top-'));
          expect(tops.map((sample) => sample.observed)).toEqual(tops.map(() => tops[0].observed));
          await host.unmount();
          await frames(page, 2);
          const destroyed = await snapshot(page, 'destroyed');
          samples.push(destroyed);
          expect(destroyed.observed).toBe(0);
        } finally {
          const metricsAfter = await cdp.send('Performance.getMetrics');
          if (tracing) {
            const complete = new Promise<void>((resolve) =>
              cdp.once('Tracing.tracingComplete', () => resolve()),
            );
            await cdp.send('Tracing.end');
            await complete;
            await info.attach('renderer-timeline.json.gz', {
              body: gzipSync(JSON.stringify({ traceEvents: trace })),
              contentType: 'application/gzip',
            });
          }
          const probe = await page.evaluate(() => ({
            frames: window.rowScaleProbe.frames,
            longtasks: window.rowScaleProbe.longtasks,
          }));
          await info.attach('row-scale-measurements', {
            body: JSON.stringify({
              renderer,
              shape,
              rows,
              viewport: page.viewportSize(),
              browser: await cdp.send('Browser.getVersion'),
              samples,
              ...probe,
              metricsBefore,
              metricsAfter,
            }),
            contentType: 'application/json',
          });
          await cdp.detach();
          expect(Math.max(0, ...probe.frames.map((frame) => frame.mounts))).toBeLessThanOrEqual(4);
        }
      });
    }
  }
}
