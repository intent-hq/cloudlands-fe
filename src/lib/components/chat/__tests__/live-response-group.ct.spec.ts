import { expect, test } from '@playwright/experimental-ct-svelte';
import LiveResponseGroupHost from './LiveResponseGroupHost.svelte';
import StreamingResponseGroupLifecycleHost from './StreamingResponseGroupLifecycleHost.svelte';

test('keeps one current row until click opens the full live history', async ({ mount }) => {
  const component = await mount(LiveResponseGroupHost);
  const trigger = component.getByTestId('response-group-disclosure');

  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('live-current-child')).toHaveText('current chunk');
  await expect(component.getByTestId('live-history-child')).toHaveCount(0);

  await component.update({ props: { chunk: 'new current chunk', isStreaming: true } });
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

test('reconciles a tag-first streaming group through explicit close and completion', async ({
  mount,
}) => {
  const component = await mount(StreamingResponseGroupLifecycleHost);
  const trigger = component.getByTestId('response-group-disclosure');
  const visibleChildren = component.locator('[data-response-group-child]');

  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(component.getByTestId('response-group-name')).toHaveText('Thinking...');

  await component.update({ props: { phase: 'live', isStreaming: true } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('response-group-name')).toHaveText('Reasoning');
  await expect(visibleChildren).toHaveCount(1);
  await expect(visibleChildren).toHaveAttribute('data-message-content-block', 'tool_use');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(visibleChildren).toHaveCount(5);
  await expect(
    component.getByText(
      'I will set the workspace title. Then I will read the current spec and inspect the screenshot context.',
    ),
  ).toBeVisible();
  await expect(
    component
      .getByTestId('response-group')
      .locator('[data-response-group-child]')
      .getByText('Reasoning', { exact: true }),
  ).toHaveCount(0);
  await expect(
    component.getByTestId('response-group').getByTestId('reasoning-disclosure'),
  ).toHaveCount(0);

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(visibleChildren).toHaveCount(1);
  await expect(visibleChildren).toHaveAttribute('data-message-content-block', 'tool_use');

  await component.update({ props: { phase: 'closed', isStreaming: false } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('response-group-name')).toHaveText('Reasoning');
  await expect(component.getByText('Workspace inspection complete.')).toBeVisible();
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(visibleChildren).toHaveCount(5);

  await component.update({ props: { phase: 'closed', isStreaming: false } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(visibleChildren).toHaveCount(5);

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(visibleChildren).toHaveCount(0);
});

test('rehydrates a completed group collapsed and opens its full history', async ({ mount }) => {
  const component = await mount(StreamingResponseGroupLifecycleHost, {
    props: { phase: 'closed', isStreaming: false },
  });
  const trigger = component.getByTestId('response-group-disclosure');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('response-group-name')).toHaveText('Reasoning');
  await expect(component.locator('[data-response-group-child]')).toHaveCount(0);
  await expect(component.getByTestId('response-group-snippet')).toHaveCount(0);
  await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(component.locator('[data-response-group-child]')).toHaveCount(5);
  await expect(
    component.getByText(
      'I will set the workspace title. Then I will read the current spec and inspect the screenshot context.',
    ),
  ).toBeVisible();
  await trigger.press('Space');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.locator('[data-response-group-child]')).toHaveCount(0);
});
