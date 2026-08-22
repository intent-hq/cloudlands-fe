import { expect, test } from '@playwright/experimental-ct-svelte';
import LiveResponseGroupHost from './LiveResponseGroupHost.svelte';

test('keeps one current row until manual expansion and collapses to the completed summary', async ({
  mount,
}) => {
  const component = await mount(LiveResponseGroupHost);
  const trigger = component.getByTestId('response-group-disclosure');

  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('live-current-child')).toHaveText('current chunk');
  await expect(component.getByTestId('live-history-child')).toHaveCount(0);

  await component.update({ props: { chunk: 'new current chunk', isStreaming: true } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('live-current-child')).toHaveText('new current chunk');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(component.getByTestId('live-current-child')).toHaveCount(0);
  await expect(component.getByTestId('live-history-child')).toHaveCount(2);

  await component.update({ props: { chunk: 'latest chunk', isStreaming: true } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(component.getByTestId('live-history-child').last()).toHaveText('latest chunk');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('live-current-child')).toHaveText('latest chunk');
  await expect(component.getByTestId('live-history-child')).toHaveCount(0);

  await component.update({ props: { chunk: 'latest chunk', isStreaming: false } });
  await expect(component.getByTestId('live-current-child')).toHaveCount(0);
  await expect(component.getByTestId('response-group-snippet')).toContainText('earlier chunk');
});
