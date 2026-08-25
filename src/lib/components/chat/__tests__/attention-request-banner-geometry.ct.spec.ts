import { expect, test } from '@playwright/experimental-ct-svelte';
import AttentionRequestBannerGeometryHost from './AttentionRequestBannerGeometryHost.svelte';

const longLabel =
  'Localized request for a detailed discussion that needs a carefully considered response';
const longReason =
  'This is a long reason with several details that must wrap below the shared header without touching either the localized label or the live relative timestamp.';

for (const kind of ['blocker', 'discussion'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [240, 720]) {
      for (const zoom of [1, 2]) {
        test(`lays out ${kind} in ${theme} at ${width}px and ${zoom * 100}%`, async ({ mount }) => {
          const component = await mount(AttentionRequestBannerGeometryHost, {
            props: {
              kind,
              theme,
              width,
              zoom,
              reason: kind === 'discussion' ? longReason : undefined,
            },
          });
          const header = component.getByTestId('attention-request-header');
          const label = component.getByTestId('attention-request-label');
          const reason = component.getByTestId('attention-request-reason');
          const timestamp = header.locator('[title]');
          if (kind === 'discussion')
            await label.evaluate((node, value) => (node.textContent = value), longLabel);

          const geometry = await component.evaluate((root) => {
            const box = (testId: string) =>
              root.querySelector(`[data-testid="${testId}"]`)!.getBoundingClientRect();
            const headerBox = box('attention-request-header');
            const labelBox = box('attention-request-label');
            const reasonBox = box('attention-request-reason');
            const timestampBox = root
              .querySelector('[data-testid="attention-request-header"] [title]')!
              .getBoundingClientRect();
            const bannerBox = box('attention-request-banner');
            const transcript = root.firstElementChild as HTMLElement;
            return {
              seam: bannerBox.top - box('preceding-chat-content').bottom,
              bannerRight: bannerBox.right,
              host: {
                clientWidth: transcript.clientWidth,
                scrollWidth: transcript.scrollWidth,
              },
              header: { top: headerBox.top, bottom: headerBox.bottom },
              label: { top: labelBox.top, right: labelBox.right },
              timestamp: {
                top: timestampBox.top,
                left: timestampBox.left,
                right: timestampBox.right,
              },
              reason: { top: reasonBox.top },
            };
          });

          expect(geometry.seam).toBeCloseTo(24 * zoom, 1);
          expect(geometry.label.top).toBeCloseTo(geometry.header.top, 1);
          expect(geometry.timestamp.top).toBeCloseTo(geometry.header.top, 1);
          expect(geometry.label.right).toBeLessThanOrEqual(geometry.timestamp.left);
          expect(geometry.reason.top).toBeGreaterThanOrEqual(geometry.header.bottom + 4 * zoom - 1);
          expect(geometry.timestamp.right).toBeLessThanOrEqual(geometry.bannerRight + 1);
          expect(geometry.host.scrollWidth).toBeLessThanOrEqual(geometry.host.clientWidth);
          await expect(timestamp).toBeVisible();
          await expect(reason).toContainText(
            kind === 'discussion' ? longReason : 'A detailed reason',
          );
        });
      }
    }
  }
}

for (const missing of ['reason', 'timestamp'] as const) {
  test(`omits a missing ${missing} without disturbing the header`, async ({ mount }) => {
    const component = await mount(AttentionRequestBannerGeometryHost, {
      props: { kind: 'blocker', width: 240, zoom: 2, [missing]: '' },
    });
    await expect(component.getByTestId('attention-request-header')).toBeVisible();
    await expect(component.getByTestId('attention-request-label')).toBeVisible();
    await expect(component.getByTestId('attention-request-reason')).toHaveCount(
      missing === 'reason' ? 0 : 1,
    );
    await expect(component.getByTestId('attention-request-header').locator('[title]')).toHaveCount(
      missing === 'timestamp' ? 0 : 1,
    );
  });
}
