import { expect, test } from '@playwright/experimental-ct-svelte';
import type { ComponentFixtures } from '@playwright/experimental-ct-svelte';
import { isolateBrowserContextPerTest } from '../../../../test/ct-isolated-browser-context';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';

test.setTimeout(120_000);
isolateBrowserContextPerTest(test, 'intent-hq/intent#4783');

test.afterEach(async ({ page }) => {
  expect(await page.pageErrors()).toEqual([]);
});

type CtLocator = ReturnType<Awaited<ReturnType<ComponentFixtures['mount']>>['locator']>;

async function measure(component: CtLocator) {
  return component.evaluate((host) => {
    const viewport = host.querySelector<HTMLElement>(
      '[data-testid="chat-transcript-scroll-viewport"]',
    )!;
    const inner = host.querySelector<HTMLElement>('[data-testid="chat-transcript-inner"]')!;
    const banner = host.querySelector<HTMLElement>('[data-testid="attention-request-banner"]')!;
    const message = host.querySelector<HTMLElement>('[data-message-id="attention-assistant-11"]')!;
    const composer = host.querySelector<HTMLElement>('[data-testid="chat-composer-shell"]')!;
    const queue = host.querySelector<HTMLElement>('[data-testid="queued-messages-container"]');
    const box = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const content = inner.getBoundingClientRect();
    const style = getComputedStyle(inner);
    const cardStyle = getComputedStyle(banner);
    return {
      banner: box(banner),
      message: box(message),
      composer: box(composer),
      viewport: box(viewport),
      queue: queue ? box(queue) : null,
      contentLeft: content.left + parseFloat(style.paddingLeft),
      contentRight: content.right - parseFloat(style.paddingRight),
      scrollTop: viewport.scrollTop,
      scrollRange: viewport.scrollHeight - viewport.clientHeight,
      inTranscript: viewport.contains(banner),
      inComposer: composer.contains(banner),
      overflow: banner.scrollWidth - banner.clientWidth,
      rounded: parseFloat(cardStyle.borderTopLeftRadius),
      border: parseFloat(cardStyle.borderTopWidth),
    };
  });
}

// Narrow wrapping and a wide column exceeding the old independent card cap
// are the two geometry contracts; both severity labels must obey them.
for (const width of [280, 720]) {
  for (const attention of ['discussion', 'blocker'] as const) {
    test(
      'scrolls aligned ' + attention + ' with messages at ' + width + 'px',
      async ({ mount, page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const component = await mount(ChatPanelComposerGeometryHost, {
          props: {
            width,
            attention,
            transcript: true,
            queued: true,
            draft: 'My response is ready.',
          },
        });
        const viewport = component.getByTestId('chat-transcript-scroll-viewport');
        const banner = component.getByTestId('attention-request-banner');
        const editor = component.getByTestId('message-input').locator('.tiptap-editor');
        const queue = component.getByTestId('queued-messages-container');
        await expect(banner).toBeVisible();
        await expect(queue).toBeVisible();
        await expect(editor).toContainText('My response is ready.');
        await component.evaluate(async () => {
          await document.fonts.ready;
        });
        await viewport.evaluate((node) => node.scrollTo(0, node.scrollHeight));
        await expect(banner).toBeInViewport({ ratio: 0.95 });
        await expect.poll(async () => (await measure(component)).scrollRange).toBeGreaterThan(640);
        const before = await measure(component);
        expect(before.queue).not.toBeNull();
        expect(before.inTranscript).toBe(true);
        expect(before.inComposer).toBe(false);
        expect(Math.abs(before.banner.left - before.message.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(before.banner.right - before.message.right)).toBeLessThanOrEqual(1);
        expect(Math.abs(before.banner.left - before.contentLeft)).toBeLessThanOrEqual(1);
        expect(Math.abs(before.banner.right - before.contentRight)).toBeLessThanOrEqual(1);
        expect(before.banner.bottom).toBeLessThanOrEqual(before.viewport.bottom + 1);
        expect(before.viewport.bottom).toBeLessThanOrEqual(before.composer.top + 1);
        expect(before.banner.bottom).toBeLessThanOrEqual(before.queue!.top);
        expect(before.overflow).toBeLessThanOrEqual(1);
        expect(before.rounded).toBeGreaterThan(0);
        expect(before.border).toBeGreaterThan(0);

        // Real wheel input releases follow-bottom ownership. Observe displacement
        // against both the scroll offset and a rendered message, not CSS spelling.
        await page.mouse.move(
          (before.viewport.left + before.viewport.right) / 2,
          (before.viewport.top + before.viewport.bottom) / 2,
        );
        await page.mouse.wheel(0, -120);
        await expect
          .poll(async () => (await measure(component)).scrollTop)
          .toBeLessThan(before.scrollTop - 30);
        const moved = await measure(component);
        expect(moved.queue).not.toBeNull();
        const displacement = before.scrollTop - moved.scrollTop;
        expect(Math.abs(moved.banner.top - before.banner.top - displacement)).toBeLessThanOrEqual(
          1,
        );
        expect(Math.abs(moved.message.top - before.message.top - displacement)).toBeLessThanOrEqual(
          1,
        );
        expect(Math.abs(moved.composer.top - before.composer.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(moved.queue!.top - before.queue!.top)).toBeLessThanOrEqual(1);
        await page.mouse.wheel(0, -100_000);
        await expect.poll(async () => viewport.evaluate((node) => node.scrollTop)).toBeLessThan(1);
        await expect(banner).not.toBeInViewport();
        // Offscreen message bodies may dehydrate; the card itself must still
        // exist below the viewport, rather than disappearing with the composer.
        const bannerTop = await banner.evaluate((node) => node.getBoundingClientRect().top);
        const viewportBottom = await viewport.evaluate(
          (node) => node.getBoundingClientRect().bottom,
        );
        expect(bannerTop).toBeGreaterThanOrEqual(viewportBottom);
        await expect(editor).toBeVisible();
        await editor.focus();
        await expect(editor).toBeFocused();
        await expect(editor).toContainText('My response is ready.');
        await component.update({ props: { attention: null } });
        await expect(banner).toHaveCount(0);
        await expect(queue).toBeVisible();
        await expect(editor).toContainText('My response is ready.');
      },
    );
  }
}

test('keeps attention in the transcript alongside questions and a queued draft until the daemon clears it', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: {
      width: 720,
      height: 800,
      attention: 'discussion',
      transcript: true,
      questions: true,
      queued: true,
      draft: 'My response is ready.',
    },
  });
  const banner = component.getByTestId('attention-request-banner');
  const viewport = component.getByTestId('chat-transcript-scroll-viewport');
  const question = component.getByTestId('question-wizard-card');
  const composer = component.getByTestId('question-composer-input');
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  const queue = component.getByTestId('queued-messages-container');
  // A seeded draft intentionally starts questions collapsed; expand as a user
  // before checking the overlay's inert composer and attention coexistence.
  await expect(editor).toContainText('My response is ready.');
  await expect(queue).toBeVisible();
  await component.getByRole('button', { name: /Click to expand/i }).click();
  await expect(question).toBeVisible();
  await expect(composer).toHaveAttribute('inert', '');
  await expect(composer).toHaveAttribute('aria-hidden', 'true');
  await expect(queue).toHaveCount(0);
  await component.update({ props: { attention: 'blocker' } });
  await expect(banner.getByTestId('attention-request-label')).toContainText(/blocker/i);
  await viewport.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  await expect(banner).toBeInViewport({ ratio: 0.95 });
  const open = await measure(component);
  expect(open.queue).toBeNull();
  expect(open.inTranscript).toBe(true);
  expect(open.inComposer).toBe(false);
  const questionBox = await question.boundingBox();
  expect(open.banner.bottom).toBeLessThanOrEqual(questionBox!.y + 1);
  await component.update({ props: { questions: false } });
  await expect(question).toHaveCount(0);
  await expect(composer).not.toHaveAttribute('inert', '');
  await expect(composer).not.toHaveAttribute('aria-hidden', 'true');
  await expect(queue).toBeVisible();
  await editor.focus();
  await expect(editor).toBeFocused();
  await expect(editor).toContainText('My response is ready.');

  // A projected user delivery is not a client-side dismissal signal. Only the
  // subsequent daemon projection's cleared attention fields retire the card.
  await component.update({ props: { responseDelivered: true } });
  await expect(component.locator('[data-message-id="attention-user-response"]')).toBeVisible();
  await expect(banner).toHaveCount(1);
  await component.update({ props: { attention: null } });
  await expect(banner).toHaveCount(0);
  await expect(queue).toBeVisible();
  await expect(editor).toContainText('My response is ready.');
  await expect(editor).toBeFocused();
});
