import { expect, test } from '../../../../test/ct-test';
import AssistantProseGeometryHost from './AssistantProseGeometryHost.svelte';

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = color
      .match(/[0-9.]+/g)!
      .slice(0, 3)
      .map(Number);
    const linear = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 720]) {
    for (const zoom of [1, 2]) {
      if (
        (theme === 'light' && (width !== 720 || zoom !== 1)) ||
        (theme === 'dark' && (width !== 320 || zoom !== 2))
      )
        continue;
      test(`keeps operational disclosures accessible in ${theme} at ${width}px and ${zoom * 100}%`, async ({
        mount,
        page,
      }) => {
        const component = await mount(AssistantProseGeometryHost, {
          props: { theme, width, zoom },
        });
        const baseline = component.locator('[data-testid="baseline-geometry"]');
        const groupButton = baseline.locator('[data-testid="group-adjacency"] button').first();
        const groupSummary = baseline
          .locator('[data-testid="group-adjacency"]')
          .locator('[data-testid="response-group-summary"]');
        const prose = baseline.locator('[data-assistant-prose]');

        await expect(groupSummary).toBeVisible();
        const expandedGeometryGroups = component.locator(
          '[data-testid="expanded-group-prose"], [data-testid="expanded-group-operational-rows"], [data-testid="streaming-expanded-group-operational-rows"]',
        );
        for (const disclosure of await expandedGeometryGroups
          .getByTestId('response-group-disclosure')
          .all()) {
          if ((await disclosure.getAttribute('aria-expanded')) === 'false') {
            await disclosure.evaluate((element) => (element as HTMLElement).click());
          }
          await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        }
        await expect(groupButton).toHaveAttribute('aria-expanded', 'false');
        await expect(prose).toHaveCount(4);

        const operationalRows = baseline.locator(
          '[data-chat-operational-row] [data-operational-disclosure-row]',
        );
        await expect(operationalRows).toHaveCount(5);

        const summaryStyles = await baseline
          .locator('[data-chat-operational-row] [data-operational-summary]')
          .evaluateAll((elements) =>
            elements.map((element) => {
              const style = getComputedStyle(element);
              return { color: style.color, fontWeight: style.fontWeight };
            }),
          );
        const laneBackground = await component
          .locator('[data-testid="assistant-prose-lane"]')
          .evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(contrastRatio(summaryStyles[0].color, laneBackground)).toBeGreaterThanOrEqual(4.5);
        const disclosure = baseline
          .locator('[data-testid="thinking-row"] [data-testid="reasoning-disclosure"]')
          .first();
        const captureDisclosureState = () =>
          disclosure.evaluate((element) => {
            const row = element.closest('[data-operational-disclosure-row]') as HTMLElement;
            const summary = element.querySelector('[data-operational-summary]') as HTMLElement;
            const leading = element.querySelector('[data-operational-leading]') as HTMLElement;
            const icon = leading.querySelector('svg') as SVGElement;
            const style = getComputedStyle(element);
            const rowStyle = getComputedStyle(row);
            const summaryStyle = getComputedStyle(summary);
            const leadingStyle = getComputedStyle(leading);
            const iconStyle = getComputedStyle(icon);
            const box = row.getBoundingClientRect();
            return {
              geometry: [box.x + window.scrollX, box.y + window.scrollY, box.width, box.height],
              row: [
                rowStyle.backgroundColor,
                rowStyle.color,
                rowStyle.opacity,
                rowStyle.borderColor,
              ],
              disclosure: [style.backgroundColor, style.color, style.opacity, style.borderColor],
              summary: [summaryStyle.color, summaryStyle.opacity],
              leading: [leadingStyle.color, leadingStyle.opacity],
              icon: [iconStyle.color, iconStyle.opacity],
              focusIndicator: style.textDecorationLine,
            };
          });
        const restingState = await captureDisclosureState();
        await disclosure.hover();
        expect(await captureDisclosureState()).toEqual(restingState);
        await disclosure.focus();
        const focusedState = await captureDisclosureState();
        expect({ ...focusedState, focusIndicator: restingState.focusIndicator }).toEqual(
          restingState,
        );
        expect(focusedState.focusIndicator).toContain('underline');

        const expandedGroup = component.locator('[data-testid="expanded-group-prose"]');

        await groupButton.click();
        const groupDetails = component.locator(
          '[data-testid="group-adjacency"] [data-operational-expanded-content]',
        );
        await expect(groupDetails).toBeVisible();
        await expect(groupDetails.locator('[data-assistant-prose]')).toHaveCount(0);
        await page.waitForTimeout(250);
        await expect(
          component.locator(
            '[data-testid="streaming-operational-cluster"] .content-block--animate-in',
          ),
        ).toHaveCount(0);

        const assertCluster = async (testId: string, expectedRows: number) => {
          const fixture = component.locator(`[data-testid="${testId}"]`);
          await fixture.scrollIntoViewIfNeeded();
          const rows = fixture.locator('[data-chat-operational-row]');
          await expect(rows).toHaveCount(expectedRows);
        };

        await assertCluster('single-operational-cluster', 1);
        await assertCluster('static-operational-cluster', 5);
        await assertCluster('streaming-operational-cluster', 5);

        await expandedGroup.scrollIntoViewIfNeeded();
        const groupProse = expandedGroup.locator(
          '[data-response-group-content] > [data-operational-window] > [data-operational-window-key] > [data-message-content-block="text"]',
        );
        await expect(groupProse).toBeVisible();

        for (const fixtureId of [
          'expanded-group-operational-rows',
          'streaming-expanded-group-operational-rows',
        ]) {
          const nestedGroup = component.locator(`[data-testid="${fixtureId}"]`);
          await nestedGroup.scrollIntoViewIfNeeded();
          const nestedGroupDisclosure = nestedGroup.locator(
            '[data-testid="response-group-disclosure"]',
          );
          await expect(nestedGroupDisclosure).toHaveAttribute('aria-expanded', 'true');
          const nestedGroupContent = nestedGroup.locator('[data-response-group-content]');
          const nestedRows = nestedGroup.locator('[data-response-group-child]');
          await expect(nestedRows).toHaveCount(2);
          await expect(nestedGroupContent).toBeVisible();
        }

        await component.getByTestId('static-operational-cluster').scrollIntoViewIfNeeded();
        const staticRows = component.locator(
          '[data-testid="static-operational-cluster"] [data-operational-cluster-row]',
        );
        // Each toggle animates its row's height and shifts every row below it.
        // Playwright only hit-tests the first pointer event, so a click issued
        // mid-animation can press one element and release over another, and the
        // browser then drops the click. Wait for the row to settle at its
        // target height before clicking the next one.
        const toggleStaticRow = async (index: number, expanded: boolean) => {
          const row = staticRows.nth(index);
          const button = row.getByRole('button');
          await button.click();
          await expect(button).toHaveAttribute('aria-expanded', String(expanded));
          await expect
            .poll(() =>
              row.locator('[data-response-group-motion="animated-height"]').evaluate((wrapper) => {
                // Measure the element animatedHeight measures: the last nested
                // height target, else the first child.
                const targets = wrapper.querySelectorAll<HTMLElement>(
                  '[data-animated-height-target]',
                );
                const content =
                  targets.item(targets.length - 1) ??
                  (wrapper.firstElementChild as HTMLElement | null);
                const target = content?.offsetHeight ?? 0;
                return Math.abs((wrapper as HTMLElement).offsetHeight - target) <= 1;
              }),
            )
            .toBe(true);
        };
        await toggleStaticRow(2, true);
        await toggleStaticRow(4, true);
        await expect(
          component.locator(
            '[data-testid="static-operational-cluster"] [data-operational-expanded-content]',
          ),
        ).toHaveCount(2);
        await assertCluster('static-operational-cluster', 5);
        await toggleStaticRow(2, false);
        await toggleStaticRow(4, false);
        await expect(
          component.locator(
            '[data-testid="static-operational-cluster"] [data-operational-expanded-content]',
          ),
        ).toHaveCount(0);
        await assertCluster('static-operational-cluster', 5);
      });
    }
  }
}

test('removes operational detail motion when reduced motion is preferred', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(AssistantProseGeometryHost);
  const disclosure = component
    .locator('[data-testid="thinking-row"] [data-testid="reasoning-disclosure"]')
    .first();
  const controls = await disclosure.getAttribute('aria-controls');
  expect(controls).toBeTruthy();

  await disclosure.click();
  const details = component.locator(`[id="${controls}"]`);
  await expect(details).toBeVisible();
  await expect(details).toContainText('Reasoning body');
  await expect.poll(() => details.evaluate((element) => element.getAnimations().length)).toBe(0);
});
