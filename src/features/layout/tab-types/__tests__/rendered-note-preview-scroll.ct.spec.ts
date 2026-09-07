import { expect, test } from '@playwright/experimental-ct-svelte';
import RenderedNotePreviewScrollHarness from './RenderedNotePreviewScrollHarness.svelte';

const longMarkdown = Array.from(
  { length: 90 },
  (_, index) => `## Section ${index + 1}\n\nRendered equation $x_${index + 1}^2$.`,
).join('\n\n');

test('isolates scroll while retargeting a mounted preview across long and short notes', async ({
  mount,
}) => {
  const component = await mount(RenderedNotePreviewScrollHarness, {
    props: { content: longMarkdown },
  });
  const preview = component.getByTestId('rendered-note-preview');
  await expect(preview).toContainText('Section 90');
  await expect.poll(() => preview.evaluate((element) => element.scrollHeight)).toBeGreaterThan(700);

  await preview.evaluate((element) => element.scrollTo({ top: 480 }));
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBe(480);

  await component.getByTestId('show-note-b').click();
  await expect(component.getByTestId('saved-scroll-a')).toHaveText('480');
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBe(360);

  await preview.evaluate((element) => element.scrollTo({ top: 180 }));
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBe(180);
  await component.update({ props: { content: `${longMarkdown}\n\n## Later update` } });
  await expect(preview).toContainText('Later update');
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBe(180);

  await component.getByTestId('show-short-note').click();
  await expect(component.getByTestId('saved-scroll-b')).toHaveText('180');
  await expect(preview).toContainText('Short note');
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBe(0);

  await component.getByTestId('show-note-a').click();
  await expect(preview).toContainText('Section 90');
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBe(480);
});
