import { expect, test } from '../../../../test/ct-test';
import ThinkingExpandedRhythmHost from './ThinkingExpandedRhythmHost.svelte';

test.setTimeout(120_000);

const expectedCompleteTags = ['P', 'H2', 'UL', 'PRE', 'P'];

for (const zoom of [1, 2]) {
  test(`preserves expanded reasoning through streaming updates at ${zoom * 100}%`, async ({
    mount,
    page,
  }, testInfo) => {
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
        const chunkRoot =
          viewer.querySelector<HTMLElement>(':scope > :is(.ProseMirror, .markdown-content)') ??
          viewer;
        return {
          chunks: Array.from(chunkRoot.children, (chunk) => ({ tag: chunk.tagName })),
          hasInlineCode: !!chunkRoot.querySelector('p code'),
          hasFencedCode: !!chunkRoot.querySelector('pre code'),
        };
      });

    const assertContent = async (fixture: typeof staticFixture, expectedTags: string[]) => {
      await expect
        .poll(async () => (await measure(fixture))?.chunks.map((chunk) => chunk.tag), {
          // Chunk hydration loads the markdown/shiki bundles; on a saturated
          // CI runner that can exceed the 5s default.
          timeout: 30_000,
        })
        .toEqual(expectedTags);
      const geometry = (await measure(fixture))!;
      expect(geometry.hasInlineCode).toBe(true);
      expect(geometry.hasFencedCode).toBe(expectedTags.includes('PRE'));
    };

    await assertContent(staticFixture, expectedCompleteTags);
    await assertContent(streamingFixture, ['P', 'H2', 'P']);
    const streamingViewer = streamingFixture.locator('.markdown-viewer');
    await streamingViewer.evaluate((viewer) => {
      viewer.setAttribute('data-reconciliation-anchor', 'stable');
    });

    await component.update({ props: { width: 280, zoom, streamStage: 'complete' } });
    await expect(streamingViewer).toHaveAttribute('data-reconciliation-anchor', 'stable');
    await assertContent(streamingFixture, expectedCompleteTags);
    await expect(streamingFixture.getByText('First streamed paragraph with')).toHaveCount(1);
    await testInfo.attach(`reasoning-content-${zoom * 100}.json`, {
      body: JSON.stringify({
        zoom,
        static: await measure(staticFixture),
        streaming: await measure(streamingFixture),
      }),
      contentType: 'application/json',
    });
  });
}
