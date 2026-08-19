import { expect, test } from '@playwright/experimental-ct-svelte';
import ThinkingExpandedRhythmHost from './ThinkingExpandedRhythmHost.svelte';

test.setTimeout(120_000);

const expectedCompleteTags = ['P', 'H2', 'UL', 'PRE', 'P'];

for (const zoom of [1, 2]) {
  test(`keeps expanded reasoning chunks at one gap at ${zoom * 100}%`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ThinkingExpandedRhythmHost, {
      props: { width: 280, zoom, streamStage: 'partial' },
    });
    const staticFixture = component.getByTestId('static-reasoning-rhythm');
    const streamingFixture = component.getByTestId('streaming-reasoning-rhythm');
    await staticFixture.getByTestId('reasoning-disclosure').click();

    // The markdown viewer hydrates asynchronously after the disclosure opens;
    // on a loaded CI runner the first poll can land before it exists. Return
    // null instead of throwing so `expect.poll` keeps retrying (a thrown
    // evaluate aborts the poll immediately).
    const measure = (fixture: typeof staticFixture) =>
      fixture.locator('[data-reasoning-expanded-body]').evaluate((body) => {
        const viewer = body.querySelector<HTMLElement>('.markdown-viewer');
        if (!viewer) return null;
        const chunkRoot = viewer.querySelector<HTMLElement>(':scope > .ProseMirror') ?? viewer;
        const rootBox = chunkRoot.getBoundingClientRect();
        const chunks = Array.from(chunkRoot.children).map((chunk) => {
          const box = chunk.getBoundingClientRect();
          const style = getComputedStyle(chunk);
          return {
            tag: chunk.tagName,
            top: box.top,
            bottom: box.bottom,
            marginTop: style.marginTop,
            marginBottom: style.marginBottom,
          };
        });
        return {
          rowGap: getComputedStyle(chunkRoot).rowGap,
          rootTop: rootBox.top,
          rootBottom: rootBox.bottom,
          chunks,
          hasInlineCode: !!chunkRoot.querySelector('p code'),
          hasFencedCode: !!chunkRoot.querySelector('pre code'),
          softHeading: (() => {
            const heading = chunkRoot.querySelector<HTMLElement>(
              ':is(br + strong, p > strong:only-child)',
            );
            if (!heading) return null;
            const style = getComputedStyle(heading);
            return { display: style.display, marginTop: style.marginTop };
          })(),
        };
      });

    const assertRhythm = async (fixture: typeof staticFixture, expectedTags: string[]) => {
      await expect
        .poll(async () => (await measure(fixture))?.chunks.map((chunk) => chunk.tag), {
          // Chunk hydration loads the markdown/shiki bundles; on a saturated
          // CI runner that can exceed the 5s default.
          timeout: 30_000,
        })
        .toEqual(expectedTags);
      const geometry = (await measure(fixture))!;
      expect(geometry.rowGap).toBe('8px');
      expect(geometry.chunks.map((chunk) => chunk.marginTop)).toEqual(
        expectedTags.map((tag, index) => (index > 0 && /^H[1-6]$/.test(tag) ? '24px' : '0px')),
      );
      expect(geometry.chunks.map((chunk) => chunk.marginBottom)).toEqual(
        expectedTags.map(() => '0px'),
      );
      expect(geometry.chunks[0].top - geometry.rootTop).toBeCloseTo(0, 1);
      expect(geometry.rootBottom - geometry.chunks.at(-1)!.bottom).toBeCloseTo(0, 1);
      for (let index = 1; index < geometry.chunks.length; index += 1) {
        const expectedGap = /^H[1-6]$/.test(geometry.chunks[index].tag) ? 32 : 8;
        expect(geometry.chunks[index].top - geometry.chunks[index - 1].bottom).toBeCloseTo(
          expectedGap * zoom,
          1,
        );
      }
      expect(geometry.hasInlineCode).toBe(true);
      expect(geometry.hasFencedCode).toBe(expectedTags.includes('PRE'));
      expect(geometry.softHeading).toEqual({ display: 'block', marginTop: '24px' });
    };

    await assertRhythm(staticFixture, expectedCompleteTags);
    await assertRhythm(streamingFixture, ['P', 'H2', 'P']);
    const streamingViewer = streamingFixture.locator('.markdown-viewer');
    await streamingViewer.evaluate((viewer) => {
      viewer.setAttribute('data-reconciliation-anchor', 'stable');
    });

    await component.update({ props: { width: 280, zoom, streamStage: 'complete' } });
    await expect(streamingViewer).toHaveAttribute('data-reconciliation-anchor', 'stable');
    await assertRhythm(streamingFixture, expectedCompleteTags);
    await expect(streamingFixture.getByText('First streamed paragraph with')).toHaveCount(1);
  });
}
