import { expect, test } from '@playwright/experimental-ct-svelte';
import LiveResponseGroupHost from './LiveResponseGroupHost.svelte';
import StreamingResponseGroupLifecycleHost from './StreamingResponseGroupLifecycleHost.svelte';

test('keeps one current row and ignores click or keyboard activation', async ({ mount }) => {
  const component = await mount(LiveResponseGroupHost);
  const summary = component.getByTestId('response-group-disclosure');

  await expect(summary).not.toHaveAttribute('aria-expanded');
  await expect(summary).not.toHaveAttribute('aria-controls');
  await expect(component.getByTestId('response-group').locator('button')).toHaveCount(0);
  await expect(component.getByTestId('live-current-child')).toHaveText('current chunk');
  await expect(component.getByTestId('live-history-child')).toHaveCount(0);

  await component.update({ props: { chunk: 'new current chunk', isStreaming: true } });
  await expect(component.getByTestId('live-current-child')).toHaveText('new current chunk');

  await summary.click();
  await summary.dispatchEvent('keydown', { key: 'Enter' });
  await summary.dispatchEvent('keydown', { key: ' ' });
  await expect(component.getByTestId('live-current-child')).toHaveText('new current chunk');
  await expect(component.getByTestId('live-history-child')).toHaveCount(0);

  await component.update({ props: { chunk: 'new current chunk', isStreaming: false } });
  await expect(component.getByTestId('live-current-child')).toHaveCount(0);
  await expect(component.getByTestId('response-group-snippet')).toContainText('earlier chunk');
  await summary.click();
  await expect(component.getByTestId('live-history-child')).toHaveCount(0);
});

test('reconciles a tag-first streaming group through explicit close and completion', async ({
  mount,
}) => {
  const component = await mount(StreamingResponseGroupLifecycleHost);
  const summary = component.getByTestId('response-group-disclosure');
  const visibleChildren = component.locator('[data-response-group-child]');

  await expect(summary).not.toHaveAttribute('aria-expanded');
  await expect(visibleChildren).toHaveCount(0);

  await component.update({ props: { phase: 'live', isStreaming: true } });
  await expect(visibleChildren).toHaveCount(1);
  await expect(visibleChildren).toHaveAttribute('data-message-content-block', 'thinking');

  await component.update({ props: { phase: 'closed', isStreaming: true } });
  await expect(visibleChildren).toHaveCount(0);
  await expect(component.getByText('Final prose.')).toBeVisible();

  await component.update({ props: { phase: 'closed', isStreaming: false } });
  await summary.click();
  await summary.dispatchEvent('keydown', { key: 'Enter' });
  await summary.dispatchEvent('keydown', { key: ' ' });
  await expect(visibleChildren).toHaveCount(0);

  await component.update({ props: { phase: 'closed', isStreaming: false } });
  await expect(visibleChildren).toHaveCount(0);
});

test('rehydrates a completed group as summary-only', async ({ mount }) => {
  const component = await mount(StreamingResponseGroupLifecycleHost, {
    props: { phase: 'closed', isStreaming: false },
  });
  await expect(component.locator('[data-response-group-child]')).toHaveCount(0);
  await expect(component.getByTestId('response-group-snippet')).toContainText(
    'Review current code.',
  );
});
