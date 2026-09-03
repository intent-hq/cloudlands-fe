import { expect, test } from '@playwright/experimental-ct-svelte';
import LiveResponseGroupHost from './LiveResponseGroupHost.svelte';
import StreamingResponseGroupLifecycleHost from './StreamingResponseGroupLifecycleHost.svelte';

test('keeps all live rows in the cylinder and the expanded history', async ({ mount }) => {
  const component = await mount(LiveResponseGroupHost);
  const trigger = component.getByTestId('response-group-disclosure');
  const preview = component.locator('[data-operational-preview-content]');
  const expanded = component.locator('[data-operational-expanded-content]');

  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(preview.getByTestId('live-current-child')).toHaveText('current chunk');
  await expect(preview.getByTestId('live-history-child')).toHaveCount(2);

  await component.update({ props: { chunk: 'new current chunk', isStreaming: true } });
  await expect(preview.getByTestId('live-current-child')).toHaveText('new current chunk');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(expanded.getByTestId('live-current-child')).toHaveCount(1);
  await expect(expanded.getByTestId('live-history-child')).toHaveCount(2);

  await component.update({ props: { chunk: 'latest chunk', isStreaming: true } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(expanded.getByTestId('live-history-child').last()).toHaveText('latest chunk');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(preview.getByTestId('live-current-child')).toHaveText('latest chunk');
  await expect(preview.getByTestId('live-history-child')).toHaveCount(2);

  await component.update({ props: { chunk: 'latest chunk', isStreaming: false } });
  await expect(component.getByTestId('live-current-child')).toHaveCount(0);
  await expect(component.getByTestId('response-group-snippet')).toContainText('earlier chunk');
});

test('caps and follows tall live rows as a streaming cylinder', async ({ mount, page }) => {
  const component = await mount(LiveResponseGroupHost, {
    props: { chunk: 'streaming line', lineCount: 12, isStreaming: true },
  });
  const trigger = component.getByTestId('response-group-disclosure');
  const scroller = component.locator('.cylinder-scroller');
  const currentLine = component.getByTestId('live-stream-line').first();
  const summary = component.getByTestId('response-group-name');
  const groupContent = component.locator('[data-response-group-content]');

  for (const width of [800, 320]) {
    await page.setViewportSize({ width, height: 480 });
    const [lineBox, summaryBox] = await Promise.all([
      currentLine.boundingBox(),
      summary.boundingBox(),
    ]);
    expect(lineBox!.x).toBeCloseTo(summaryBox!.x, 0);
  }

  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(scroller).toHaveCSS('max-height', '100px');
  expect((await scroller.boundingBox())!.height).toBeLessThanOrEqual(100);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(() => scroller.evaluate((node) => node.style.maskImage))
    .toContain('linear-gradient');

  await scroller.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => scroller.evaluate((node) => node.style.maskImage)).toBe('');
  await page.waitForTimeout(200);

  await component.update({
    props: { chunk: 'latest streaming line', lineCount: 14, isStreaming: true },
  });
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(() => scroller.evaluate((node) => node.style.maskImage))
    .toContain('linear-gradient');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(scroller).not.toHaveCSS('max-height', '100px');
  await expect(component.getByTestId('live-history-child')).toHaveCount(2);
  const [contentBox, guideBox] = await Promise.all([
    groupContent.boundingBox(),
    component.locator('.pointer-events-none.absolute.inset-y-0').boundingBox(),
  ]);
  expect(guideBox!.x + guideBox!.width / 2 - contentBox!.x).toBeCloseTo(18, 0);
});

test('reconciles a tag-first streaming group through explicit close and completion', async ({
  mount,
}) => {
  const component = await mount(StreamingResponseGroupLifecycleHost);
  const trigger = component.getByTestId('response-group-disclosure');
  const visibleChildren = component.locator('[data-response-group-child]');
  const previewChildren = component.locator(
    '[data-operational-preview-content] [data-response-group-child]',
  );
  const expandedChildren = component.locator(
    '[data-operational-expanded-content] [data-response-group-child]',
  );

  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(component.getByTestId('response-group-name')).toHaveText('Thinking...');

  await component.update({ props: { phase: 'live', isStreaming: true } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('response-group-name')).toHaveText('Reasoning');
  await expect(previewChildren).toHaveCount(5);
  await expect(
    component.locator(
      '[data-operational-preview-content] [data-response-group-child][data-message-content-block="tool_use"]',
    ),
  ).toHaveCount(2);

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(expandedChildren).toHaveCount(5);
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
  await expect(previewChildren).toHaveCount(5);

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
