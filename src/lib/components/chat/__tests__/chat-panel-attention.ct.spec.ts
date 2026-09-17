import { expect, test } from '@playwright/experimental-ct-svelte';
import { isolateBrowserContextPerTest } from '../../../../test/ct-isolated-browser-context';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';

test.setTimeout(120_000);
isolateBrowserContextPerTest(test, 'intent-hq/intent#4783');

for (const width of [280, 720]) {
  test(`keeps pending attention above the prompt and queue at ${width}px`, async ({ mount }) => {
    const component = await mount(ChatPanelComposerGeometryHost, {
      props: { width, attention: 'discussion', draft: 'My response is ready.' },
    });
    const input = component.getByTestId('message-input');
    const banner = component.getByTestId('attention-request-banner');
    await expect(input).toBeVisible();
    await expect(banner).toBeVisible();
    await component.update({
      props: {
        width,
        attention: 'blocker',
        queued: true,
        draft: 'My response is ready.',
      },
    });
    const queue = component.getByTestId('queued-messages-container');
    await expect(banner.getByTestId('attention-request-label')).toContainText(/blocker/i);
    await expect(queue).toBeVisible();
    const geometry = await banner.evaluate((node) => {
      const composer = node.closest('[data-testid="chat-composer-shell"]');
      const input = document.querySelector('[data-testid="message-input"]')!;
      const queue = document.querySelector('[data-testid="queued-messages-container"]')!;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        inComposer: Boolean(composer),
        bottom: box.bottom,
        inputTop: input.getBoundingClientRect().top,
        queueTop: queue.getBoundingClientRect().top,
        overflow: node.scrollWidth - node.clientWidth,
        rounded: parseFloat(style.borderTopLeftRadius),
        border: parseFloat(style.borderTopWidth),
      };
    });
    expect(geometry.inComposer).toBe(true);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.inputTop);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.queueTop);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(geometry.rounded).toBeGreaterThan(0);
    expect(geometry.border).toBeGreaterThan(0);
    await input.locator('.tiptap-editor').focus();
    await expect(input.locator('.tiptap-editor')).toBeFocused();
    await component.update({
      props: {
        width,
        attention: null,
        queued: true,
        draft: 'My response is ready.',
      },
    });
    await expect(banner).toHaveCount(0);
    await expect(queue).toBeVisible();
    await expect(input.locator('.tiptap-editor')).toContainText('My response is ready.');
  });
}
