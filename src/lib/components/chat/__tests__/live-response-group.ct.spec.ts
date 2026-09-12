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

test('settles a keyed current-child swap on the new child', async ({ mount }) => {
  const component = await mount(LiveResponseGroupHost, {
    props: { chunk: 'first chunk', chunkKey: 'child-a' },
  });
  const child = component.getByTestId('live-current-child');
  await expect(child).toHaveText('first chunk');

  await component.update({
    props: { chunk: 'second chunk', chunkKey: 'child-b', isStreaming: true },
  });
  await expect(child.last()).toHaveText('second chunk');
  await expect(child).toHaveCount(1);
  await expect(child).toHaveText('second chunk');
});

test('swaps the current child instantly under reduced motion', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(LiveResponseGroupHost, {
    props: { chunk: 'first chunk', chunkKey: 'child-a' },
  });
  const child = component.getByTestId('live-current-child');
  await expect(child).toHaveText('first chunk');

  await component.update({
    props: { chunk: 'second chunk', chunkKey: 'child-b', isStreaming: true },
  });
  await expect(child).toHaveCount(1);
  await expect(child).toHaveText('second chunk');
});

test('keeps terminal tag-first reasoning open until explicit collapse and preserves overrides', async ({
  mount,
}) => {
  const component = await mount(StreamingResponseGroupLifecycleHost);
  const trigger = component.getByTestId('response-group-disclosure');
  const visibleChildren = component.locator('[data-response-group-child]');

  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(component.getByTestId('response-group-name')).toHaveText('Thinking...');
  await expect(visibleChildren).toHaveCount(1);
  await expect(component.getByText('Searching workspace API for title setting')).toHaveCount(1);
  await expect(component.getByTestId('reasoning-history-row')).toHaveCount(1);

  await component.update({ props: { phase: 'live', isStreaming: true } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(component.getByTestId('response-group-name')).toHaveText(
    'Invoking workspace API to set title',
  );
  await expect(
    component.getByText('Invoking workspace API to set title', { exact: true }),
  ).toHaveCount(1);
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
  await expect(component.getByTestId('response-group-name')).toHaveText(
    'Invoking workspace API to set title',
  );
  await expect(
    component.getByText('Invoking workspace API to set title', { exact: true }),
  ).toHaveCount(1);
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

test('rehydrates a completed non-terminal group collapsed and opens its full history', async ({
  mount,
}) => {
  const component = await mount(StreamingResponseGroupLifecycleHost, {
    props: { phase: 'closed', isStreaming: false },
  });
  const trigger = component.getByTestId('response-group-disclosure');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('response-group-name')).toHaveText(
    'Invoking workspace API to set title',
  );
  await expect(trigger).toHaveAccessibleName('Invoking workspace API to set title');
  await expect(
    component.getByText('Invoking workspace API to set title', { exact: true }),
  ).toHaveCount(1);
  await expect(component.locator('[data-response-group-child]')).toHaveCount(0);
  await expect(component.getByTestId('response-group-snippet')).toHaveCount(0);
  await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(component.locator('[data-response-group-child]')).toHaveCount(5);
  await expect(
    component.getByText('Invoking workspace API to set title', { exact: true }),
  ).toHaveCount(1);
  await expect(
    component.getByText(
      'I will set the workspace title. Then I will read the current spec and inspect the screenshot context.',
    ),
  ).toBeVisible();
  await trigger.press('Space');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.locator('[data-response-group-child]')).toHaveCount(0);
});

test('expands terminal reasoning on completion but restores historical content collapsed', async ({
  mount,
}) => {
  const component = await mount(StreamingResponseGroupLifecycleHost, {
    props: { phase: 'live', isStreaming: true },
  });
  const trigger = component.getByTestId('response-group-disclosure');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  await component.update({ props: { phase: 'terminal', isStreaming: false } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(component.locator('[data-response-group-child]')).toHaveCount(5);
  await component.unmount();

  const restored = await mount(StreamingResponseGroupLifecycleHost, {
    props: { phase: 'terminal', isStreaming: false },
  });
  await expect(restored.getByTestId('response-group-disclosure')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('updates automatic live reasoning from terminal to final prose and back', async ({
  mount,
}) => {
  const component = await mount(StreamingResponseGroupLifecycleHost, {
    props: { phase: 'live', isStreaming: true },
  });
  const trigger = component.getByTestId('response-group-disclosure');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  await component.update({ props: { phase: 'closed', isStreaming: true } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await component.update({ props: { phase: 'terminal', isStreaming: true } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await component.update({ props: { phase: 'terminal', isStreaming: false } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

test('restores search-owned live reasoning to its current automatic terminal state', async ({
  mount,
}) => {
  const component = await mount(StreamingResponseGroupLifecycleHost, {
    props: { phase: 'closed', isStreaming: true },
  });
  const group = component.getByTestId('response-group');
  const trigger = component.getByTestId('response-group-disclosure');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await group.dispatchEvent('chatsearchexpand');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await component.update({ props: { phase: 'terminal', isStreaming: true } });
  await group.dispatchEvent('chatsearchrestore');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
});
