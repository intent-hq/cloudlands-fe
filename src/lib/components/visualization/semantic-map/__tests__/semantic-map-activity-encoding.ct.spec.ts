import { expect, test } from '@playwright/experimental-ct-svelte';
import SemanticMapCanvasHost from './SemanticMapCanvasHost.svelte';

test('reduced motion preserves distinct read, edit, tool, and thinking encodings', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  const component = await mount(SemanticMapCanvasHost, { props: { activityFixture: true } });
  const agents = component.getByRole('list', { name: 'Agents' });

  await expect(
    agents.getByText('Reading: reading in First, 0 edits in window.', { exact: true }),
  ).toBeAttached();
  await expect(
    agents.getByText('Thinking: thinking in Second, 1 edit in window.', { exact: true }),
  ).toBeAttached();
  await expect(agents.getByRole('listitem')).toHaveCount(3);
});
