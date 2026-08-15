import { expect, test } from '@playwright/experimental-ct-svelte';
import AssistantProseGeometryHost from './AssistantProseGeometryHost.svelte';

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 720]) {
    for (const zoom of [1, 2]) {
      test(`aligns top-level prose with group text in ${theme} at ${width}px and ${zoom * 100}%`, async ({
        mount,
      }) => {
        const component = await mount(AssistantProseGeometryHost, {
          props: { theme, width, zoom },
        });
        const groupButton = component.locator('[data-testid="group-adjacency"] button').first();
        const groupSummary = component.locator('[data-testid="response-group-summary"]');
        const prose = component.locator('[data-assistant-prose]');

        await expect(groupSummary).toBeVisible();
        await expect(prose).toHaveCount(4);

        const operationalRows = component.locator('[data-operational-disclosure-row]');
        await expect(operationalRows).toHaveCount(4);
        const operationalContentXs: number[] = [];
        for (const row of await operationalRows.all()) {
          const geometry = await row.evaluate((element) => {
            const style = getComputedStyle(element);
            const iconBox = element.querySelector(
              '[data-operational-icon-box], [data-tool-icon]',
            ) as HTMLElement;
            const icon = iconBox.querySelector('svg') as SVGElement;
            const content = (
              element.matches('button')
                ? element.children[1]
                : element.querySelector('button > :nth-child(2), [data-tool-sentence]')
            ) as HTMLElement;
            return {
              contentX: content.getBoundingClientRect().x,
              height: element.getBoundingClientRect().height,
              iconBoxSize: iconBox.getBoundingClientRect().width,
              iconSize: icon.getBoundingClientRect().width,
              minHeight: style.minHeight,
              padding: [
                style.paddingInlineStart,
                style.paddingInlineEnd,
                style.paddingBlockStart,
                style.paddingBlockEnd,
              ],
            };
          });
          expect(geometry.minHeight).toBe('36px');
          expect(geometry.height).toBeGreaterThanOrEqual(36 * zoom);
          expect(geometry.iconBoxSize).toBeCloseTo(20 * zoom, 1);
          expect(geometry.iconSize).toBeCloseTo(18 * zoom, 1);
          expect(geometry.padding).toEqual(['12px', '12px', '8px', '8px']);
          operationalContentXs.push(geometry.contentX);
        }

        const groupX = (await groupSummary.boundingBox())!.x;
        for (const contentX of operationalContentXs) expect(contentX).toBeCloseTo(groupX, 1);
        for (const marker of await prose.all()) {
          const firstChild = marker.locator(':scope > *').first();
          const box = await firstChild.boundingBox();
          expect(box?.x).toBeCloseTo(groupX, 1);
        }

        const laneBox = (await component
          .locator('[data-testid="assistant-prose-lane"]')
          .boundingBox())!;
        const toolBox = (await component
          .locator('[data-testid="full-width-tool"] > *')
          .boundingBox())!;
        expect(toolBox.x).toBeCloseTo(laneBox.x, 1);
        expect(toolBox.x + toolBox.width).toBeCloseTo(laneBox.x + laneBox.width, 1);

        await groupButton.click();
        const groupDetails = component.locator(
          '[data-testid="group-adjacency"] [data-operational-expanded-content]',
        );
        await expect(groupDetails).toBeVisible();
        await expect(groupDetails.locator('[data-assistant-prose]')).toHaveCount(0);
      });
    }
  }
}
