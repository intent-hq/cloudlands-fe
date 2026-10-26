import { expect, expectNoAnimations, test } from '../../../../../test/ct-test';
import { intentMarkPoses } from '../intent-mark-poses';
import IntentMarkLoaderHost from './IntentMarkLoaderHost.svelte';

// intent-hq/intent#4750: the small mark blurred mid-Bloom because WAAPI rotated and
// scaled the arms as composited, cached textures. Bloom must stay plain vector style
// writes on the shared frame clock, so Chromium re-rasterizes every pose: no
// composited layer, will-change hint or animation may exist on the mark mid-loop.

type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Session = Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>;
type Layers = { layers?: { backendNodeId?: number }[] };

const bloomFrames = intentMarkPoses('bloom', 0).length;
const loaderSelector = '[data-slot="intent-mark-loader"]';

/** Index of the Bloom pose the live arms currently hold, or -1. */
async function liveFrame(page: Page): Promise<number> {
  const table = Array.from({ length: bloomFrames }, (_, frame) =>
    [0, 1, 2, 3, 4].map((index) => intentMarkPoses('bloom', index)[frame]),
  );
  return page.evaluate(
    ([poses, selector]) => {
      const scratch = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const key = (style: CSSStyleDeclaration) =>
        `${style.transform}|${style.strokeDasharray}|${style.strokeDashoffset}`;
      const normalize = (pose: Record<string, string>) => {
        scratch.removeAttribute('style');
        Object.assign(scratch.style, pose);
        return key(scratch.style);
      };
      const live = Array.from(
        document.querySelectorAll<SVGPathElement>(`${selector} [data-mark-arm]`),
      ).map((path) => key(path.style));
      return poses.findIndex((frame) =>
        frame.every((pose, index) => normalize(pose) === live[index]),
      );
    },
    [table, loaderSelector] as const,
  );
}

/** Keep the most recent composited layer tree; every repaint reports a new one. */
async function watchLayers(
  page: Page,
): Promise<{ session: Session; latest: () => Layers | undefined }> {
  const session = await page.context().newCDPSession(page);
  let latest: Layers | undefined;
  session.on('LayerTree.layerTreeDidChange', (event: Layers) => {
    latest = event;
  });
  await session.send('DOM.getDocument', { depth: -1 });
  await session.send('LayerTree.enable');
  return { session, latest: () => latest };
}

async function layersInLoader(session: Session, tree: Layers | undefined): Promise<number> {
  expect(tree, 'LayerTree reported no tree').toBeDefined();
  let count = 0;
  for (const layer of tree!.layers ?? []) {
    if (!layer.backendNodeId) continue;
    const { object } = await session.send('DOM.resolveNode', {
      backendNodeId: layer.backendNodeId,
    });
    if (!object.objectId) continue;
    const { result } = await session.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function(){return !!(this.closest && this.closest('${loaderSelector}'))}`,
      returnByValue: true,
    });
    if (result.value) count++;
  }
  return count;
}

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`16px Bloom at DPR ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor, contextOptions: { reducedMotion: 'no-preference' } });

    test('mid-bloom poses are vector style writes with no composited layer', async ({
      mount,
      page,
    }) => {
      await page.clock.install();
      // install() alone keeps time flowing; pause so each sampled pose holds.
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
      await mount(IntentMarkLoaderHost, { props: { size: 16 } });
      const loader = page.locator(loaderSelector);
      const layers = await watchLayers(page);
      // Crossfade settle (160ms timer), then the 30fps loop owns the arms.
      await page.clock.runFor(400);
      await expect(loader).toHaveAttribute('data-motion-state', 'playing');

      const seen = new Set<number>();
      for (let step = 0; step < 12; step++) {
        await page.clock.runFor(5 * (1000 / 30));
        const frame = await liveFrame(page);
        expect(frame, 'live arms hold a Bloom pose from the shared table').toBeGreaterThanOrEqual(
          0,
        );
        seen.add(frame);
        const willChange = await loader.evaluate((root) =>
          [root, ...root.querySelectorAll('g, path')].map(
            (node) => getComputedStyle(node).willChange,
          ),
        );
        expect(willChange.every((value) => value === 'auto')).toBe(true);
        await expectNoAnimations(loader);
        // A screenshot forces a paint so the layer tree reflects this pose.
        await loader.screenshot();
        expect(await layersInLoader(layers.session, layers.latest())).toBe(0);
      }
      // The loop really advanced through Bloom while being observed.
      expect(seen.size).toBeGreaterThanOrEqual(8);
      await layers.session.detach();
    });
  });
}
