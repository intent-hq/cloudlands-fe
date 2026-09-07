import { expect, test } from '@playwright/experimental-ct-svelte';
import RenderedNotePreviewScrollHarness from './RenderedNotePreviewScrollHarness.svelte';

const longMarkdown = Array.from(
  { length: 90 },
  (_, index) => `## Section ${index + 1}\n\nRendered equation $x_${index + 1}^2$.`,
).join('\n\n');

test('restores preview scroll after asynchronous Markdown rendering and remount', async ({
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

  await component.getByTestId('toggle-preview').click();
  await expect(component.getByTestId('saved-scroll-position')).toHaveText('480');
  await component.getByTestId('toggle-preview').click();

  const remountedPreview = component.getByTestId('rendered-note-preview');
  await expect(remountedPreview).toContainText('Section 90');
  await expect.poll(() => remountedPreview.evaluate((element) => element.scrollTop)).toBe(480);

  await remountedPreview.evaluate((element) => element.scrollTo({ top: 180 }));
  await expect.poll(() => remountedPreview.evaluate((element) => element.scrollTop)).toBe(180);
  await component.update({ props: { content: `${longMarkdown}\n\n## Later update` } });
  await expect(remountedPreview).toContainText('Later update');
  await expect.poll(() => remountedPreview.evaluate((element) => element.scrollTop)).toBe(180);
});
