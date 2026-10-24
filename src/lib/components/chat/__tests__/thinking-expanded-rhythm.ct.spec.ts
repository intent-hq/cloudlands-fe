import { expect, test } from '../../../../test/ct-test';
import ThinkingExpandedRhythmHost from './ThinkingExpandedRhythmHost.svelte';

test.setTimeout(120_000);

test('preserves expanded reasoning through streaming updates', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ThinkingExpandedRhythmHost, {
    props: { width: 280, streamStage: 'partial' },
  });
  const streamingFixture = component.getByTestId('streaming-reasoning-rhythm');
  const streamingViewer = streamingFixture.locator('.markdown-viewer');
  await expect(streamingViewer).toBeVisible({ timeout: 30_000 });
  await streamingViewer.evaluate((viewer) => {
    viewer.setAttribute('data-reconciliation-anchor', 'stable');
  });

  await component.update({ props: { width: 280, streamStage: 'complete' } });
  await expect(streamingFixture).toContainText('Final streamed paragraph.', { timeout: 30_000 });
  await expect(streamingViewer).toHaveAttribute('data-reconciliation-anchor', 'stable');
  await expect(streamingFixture.getByText('First streamed paragraph with')).toHaveCount(1);
});
