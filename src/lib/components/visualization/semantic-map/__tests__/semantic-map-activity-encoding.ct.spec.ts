import { expect, test } from '@playwright/experimental-ct-svelte';
import SemanticMapCanvasHost from './SemanticMapCanvasHost.svelte';

test('reduced motion preserves distinct read, edit, tool, and thinking encodings', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  const component = await mount(SemanticMapCanvasHost, { props: { activityFixture: true } });
  const activity = component.getByRole('list', { name: 'Activity' });

  await expect(activity.getByRole('listitem', { name: 'Read', exact: true })).toBeAttached();
  await expect(activity.getByRole('listitem', { name: 'Edit', exact: true })).toBeAttached();
  await expect(
    activity.getByRole('listitem', { name: 'Tooling: Tool', exact: true }),
  ).toBeAttached();
  await expect(
    activity.getByRole('listitem', { name: 'Thinking: Thinking', exact: true }),
  ).toBeAttached();
});
