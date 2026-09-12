import { expect, test } from '@playwright/experimental-ct-svelte';
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
      test(`aligns top-level prose with group text in ${theme} at ${width}px and ${zoom * 100}%`, async ({
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
              contentX: content.getBoundingClientRect().x + window.scrollX,
              height: element.getBoundingClientRect().height,
              iconBoxSize: iconBox.getBoundingClientRect().width,
              iconSize: icon.getBoundingClientRect().width,
              iconCenter: {
                x: icon.getBoundingClientRect().x + icon.getBoundingClientRect().width / 2,
                y: icon.getBoundingClientRect().y + icon.getBoundingClientRect().height / 2,
              },
              slotCenter: {
                x: iconBox.getBoundingClientRect().x + iconBox.getBoundingClientRect().width / 2,
                y: iconBox.getBoundingClientRect().y + iconBox.getBoundingClientRect().height / 2,
              },
              padding: [
                style.paddingInlineStart,
                style.paddingInlineEnd,
                style.paddingBlockStart,
                style.paddingBlockEnd,
              ],
            };
          });
          expect(geometry.height).toBeCloseTo(28 * zoom, 1);
          expect(geometry.iconBoxSize).toBeCloseTo(20 * zoom, 1);
          expect(geometry.iconSize).toBeCloseTo(16 * zoom, 1);
          expect(geometry.iconCenter.x).toBeCloseTo(geometry.slotCenter.x, 1);
          expect(geometry.iconCenter.y).toBeCloseTo(geometry.slotCenter.y, 1);
          expect(geometry.padding).toEqual(['8px', '8px', '0px', '0px']);
          operationalContentXs.push(geometry.contentX);
        }

        const groupX = await groupSummary.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return box.x + window.scrollX;
        });
        for (const contentX of operationalContentXs) expect(contentX).toBeCloseTo(groupX, 1);

        const summaryStyles = await baseline
          .locator('[data-chat-operational-row] [data-operational-summary]')
          .evaluateAll((elements) =>
            elements.map((element) => {
              const style = getComputedStyle(element);
              return { color: style.color, fontWeight: style.fontWeight };
            }),
          );
        const segmentStyles = await baseline
          .locator(
            '[data-chat-operational-row] [data-operational-summary], [data-chat-operational-row] [data-tool-primary], [data-chat-operational-row] [data-tool-secondary]',
          )
          .evaluateAll((elements) =>
            elements.map((element) => {
              const style = getComputedStyle(element);
              return { color: style.color, fontWeight: style.fontWeight };
            }),
          );
        expect(summaryStyles).toHaveLength(5);
        expect(new Set(segmentStyles.map(({ color }) => color)).size).toBe(1);
        expect(segmentStyles.every(({ fontWeight }) => fontWeight === '400')).toBe(true);
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
        const expandedGroupDisclosure = expandedGroup.locator(
          '[data-testid="response-group-disclosure"]',
        );
        await expect(expandedGroupDisclosure).toHaveAttribute('aria-expanded', 'true');
        const leadingIconNames = await component
          .locator('[data-chat-operational-row] [data-operational-leading] [data-icon]')
          .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-icon')));
        expect([...new Set(leadingIconNames)].sort()).toEqual([
          'arrows-in-line-vertical',
          'arrows-out-line-vertical',
          'brain',
          'eye',
          'hand',
        ]);
        for (const marker of await prose.all()) {
          const firstChild = marker.locator(':scope > *').first();
          const childX = await firstChild.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return box.x + window.scrollX;
          });
          expect(childX).toBeCloseTo(groupX, 1);
        }

        for (const fixtureId of ['static-rich-block', 'streaming-rich-block']) {
          const fixture = component.locator(`[data-testid="${fixtureId}"]`);
          const richProse = fixture.locator('[data-assistant-prose]');
          await expect(richProse).toHaveCount(1);
          const proseX = await richProse
            .locator(':scope > *')
            .first()
            .evaluate((element) => {
              const box = element.getBoundingClientRect();
              return box.x + window.scrollX;
            });
          const codeBlock = fixture.locator('.code-block-container');
          await expect(codeBlock).toBeVisible();
          const codeX = await codeBlock.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return box.x + window.scrollX;
          });
          expect(proseX).toBeCloseTo(groupX, 1);
          expect(codeX).toBeCloseTo(proseX, 1);
        }

        const laneBox = await baseline.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x + window.scrollX, width: box.width };
        });
        const toolBox = await baseline
          .locator('[data-testid="full-width-tool"] > *')
          .evaluate((element) => {
            const box = element.getBoundingClientRect();
            return { x: box.x + window.scrollX, width: box.width };
          });
        expect(toolBox.x).toBeCloseTo(laneBox.x, 1);
        expect(toolBox.x + toolBox.width).toBeCloseTo(laneBox.x + laneBox.width, 1);

        for (const mode of ['static', 'streaming']) {
          const inlineGroup = component.locator(`[data-testid="headerless-inline-${mode}"]`);
          const responseGroup = inlineGroup.locator('[data-testid="response-group"]');
          await expect(responseGroup).toHaveCount(1);
          const disclosure = responseGroup.getByTestId('response-group-disclosure');
          if ((await disclosure.getAttribute('aria-expanded')) === 'false')
            await disclosure.click();
          const inlineProse = inlineGroup.getByText('Inline assistant prose', { exact: true });
          await expect(inlineProse).toHaveCount(1);
          const inlineProseX = await inlineProse.evaluate(
            (element) => element.getBoundingClientRect().left,
          );
          expect(inlineProseX).toBeCloseTo(groupX, 1);

          const inlineRows = responseGroup.locator(
            '[data-response-group-child]:has([data-operational-disclosure-row])',
          );
          await expect(inlineRows).toHaveCount(2);
          const inlineGeometry = await inlineRows.evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect();
              const parentBox = element.parentElement!.getBoundingClientRect();
              return {
                inset: box.left - parentBox.left,
                marginLeft: getComputedStyle(element).marginLeft,
                rightEdge: box.right,
                parentRightEdge: parentBox.right,
              };
            }),
          );
          for (const geometry of inlineGeometry) {
            expect(geometry.inset).toBeCloseTo(8 * zoom, 1);
            expect(geometry.marginLeft).toBe('8px');
            expect(geometry.rightEdge).toBeCloseTo(geometry.parentRightEdge, 1);
          }
        }

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
          const stack = fixture.locator(':scope > *');
          const rows = fixture.locator('[data-chat-operational-row]');
          await expect(rows).toHaveCount(expectedRows);
          const rowLines = rows.locator('[data-operational-disclosure-row]');
          const heights = await rowLines.evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().height),
          );
          for (const height of heights) expect(height).toBeCloseTo(28 * zoom, 1);
          const icons = rows.locator('[data-operational-leading] svg');
          await expect(icons).toHaveCount(expectedRows);
          const iconWidths = await icons.evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().width),
          );
          for (const width of iconWidths) expect(width).toBeCloseTo(16 * zoom, 1);
          const summaryStyles = await rows
            .locator('[data-operational-summary]')
            .evaluateAll((elements) =>
              elements.map((element) => {
                const style = getComputedStyle(element);
                return {
                  color: style.color,
                  fontSize: style.fontSize,
                  fontWeight: style.fontWeight,
                };
              }),
            );
          expect(new Set(summaryStyles.map((style) => style.color)).size).toBe(1);
          expect(new Set(summaryStyles.map((style) => style.fontSize)).size).toBe(1);
          for (const style of summaryStyles) expect(style.fontWeight).toBe('400');
          const boxes = await rows.evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect();
              return { top: box.top, bottom: box.bottom };
            }),
          );
          const expectedGaps = Array.from({ length: expectedRows - 1 }, () => 0);
          for (let index = 1; index < boxes.length; index += 1) {
            expect(boxes[index].top - boxes[index - 1].bottom).toBeCloseTo(
              expectedGaps[index - 1] * zoom,
              1,
            );
          }

          const firstBlock = fixture.locator('[data-message-content-block]').first();
          const lastBlock = fixture.locator('[data-message-content-block]').last();
          const firstRow = rows.first();
          const lastRow = rows.last();
          if (expectedRows === 1) {
            const stackBox = (await stack.boundingBox())!;
            const firstRowBox = (await firstRow.boundingBox())!;
            expect(firstRowBox.y - stackBox.y).toBeCloseTo(0, 1);
            expect(stackBox.y + stackBox.height - (firstRowBox.y + firstRowBox.height)).toBeCloseTo(
              0,
              1,
            );
          } else {
            const firstBlockBox = (await firstBlock.boundingBox())!;
            const lastBlockBox = (await lastBlock.boundingBox())!;
            const firstRowBox = (await firstRow.boundingBox())!;
            const lastRowBox = (await lastRow.boundingBox())!;
            expect(firstRowBox.y - (firstBlockBox.y + firstBlockBox.height)).toBeCloseTo(
              16 * zoom,
              1,
            );
            expect(lastBlockBox.y - (lastRowBox.y + lastRowBox.height)).toBeCloseTo(0, 1);
          }
        };

        await assertCluster('single-operational-cluster', 1);
        await assertCluster('static-operational-cluster', 5);
        await assertCluster('streaming-operational-cluster', 5);

        const groupRow = expandedGroup.locator('[data-operational-disclosure-row]');
        const groupProse = expandedGroup.locator(
          '[data-response-group-content] > [data-message-content-block="text"]',
        );
        await expect(groupProse).toBeVisible();
        const [groupRowBox, groupProseBox] = await Promise.all([
          groupRow.boundingBox(),
          groupProse.boundingBox(),
        ]);
        expect(groupProseBox!.y - (groupRowBox!.y + groupRowBox!.height)).toBeCloseTo(16 * zoom, 1);

        for (const fixtureId of [
          'expanded-group-operational-rows',
          'streaming-expanded-group-operational-rows',
        ]) {
          const nestedGroup = component.locator(`[data-testid="${fixtureId}"]`);
          const nestedGroupDisclosure = nestedGroup.locator(
            '[data-testid="response-group-disclosure"]',
          );
          await expect(nestedGroupDisclosure).toHaveAttribute('aria-expanded', 'true');
          const nestedGroupContent = nestedGroup.locator('[data-response-group-content]');
          const nestedRows = nestedGroup.locator('[data-response-group-child]');
          await expect(nestedRows).toHaveCount(2);
          const nestedGeometry = await nestedRows.evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect();
              const parentBox = element.parentElement!.getBoundingClientRect();
              const style = getComputedStyle(element);
              return {
                inset: box.left - parentBox.left,
                marginLeft: style.marginLeft,
                rightEdge: box.right,
                parentRightEdge: parentBox.right,
              };
            }),
          );
          await expect(nestedGroupContent).toBeVisible();
          for (const row of nestedGeometry) {
            expect(row.inset).toBeCloseTo(8 * zoom, 1);
            expect(row.marginLeft).toBe('8px');
            expect(row.rightEdge).toBeCloseTo(row.parentRightEdge, 1);
          }
        }

        for (const mode of ['static', 'streaming']) {
          for (const pair of [
            'tool-tool',
            'tool-reasoning',
            'reasoning-tool',
            'reasoning-context',
            'context-tool',
            'group-tool',
            'tool-group',
            'group-group',
          ]) {
            const fixture = component.locator(`[data-testid="operational-pair-${mode}-${pair}"]`);
            const rows = fixture.locator('[data-operational-row-container]');
            await expect(rows).toHaveCount(2);
            const boxes = await rows.evaluateAll((elements) =>
              elements.map((element) => {
                const box = element.getBoundingClientRect();
                return { top: box.top, bottom: box.bottom };
              }),
            );
            expect(boxes[1].top - boxes[0].bottom).toBeCloseTo(0, 1);
            const wrapperMargins = await rows.evaluateAll((elements) =>
              elements.map((element) => {
                const row = getComputedStyle(element);
                const block = element.closest('[data-message-content-block]')!;
                const blockStyle = getComputedStyle(block);
                const intermediateMargins: string[][] = [];
                let wrapper = element.parentElement;
                while (wrapper && wrapper !== block) {
                  const style = getComputedStyle(wrapper);
                  intermediateMargins.push([
                    style.marginTop,
                    style.marginRight,
                    style.marginBottom,
                    style.marginLeft,
                  ]);
                  wrapper = wrapper.parentElement;
                }
                return {
                  rowTop: row.marginTop,
                  blockTop: blockStyle.marginTop,
                  blockBottom: blockStyle.marginBottom,
                  intermediateMargins,
                };
              }),
            );
            expect(wrapperMargins[0].blockBottom).toBe('0px');
            for (const margins of wrapperMargins.flatMap(
              ({ intermediateMargins }) => intermediateMargins,
            )) {
              expect(margins).toEqual(['0px', '0px', '0px', '0px']);
            }
            expect(wrapperMargins[1]).toMatchObject({
              rowTop: '0px',
              blockTop: '0px',
              blockBottom: '0px',
            });
            await expect(fixture.locator('[data-operational-stack]')).toHaveCSS('row-gap', '0px');
          }
        }

        const staticRows = component.locator(
          '[data-testid="static-operational-cluster"] [data-operational-cluster-row]',
        );
        await staticRows.nth(2).getByRole('button').click();
        await staticRows.nth(4).getByRole('button').click();
        await expect(
          component.locator(
            '[data-testid="static-operational-cluster"] [data-operational-expanded-content]',
          ),
        ).toHaveCount(2);
        await page.waitForTimeout(200);
        await assertCluster('static-operational-cluster', 5);
        await staticRows.nth(2).getByRole('button').click();
        await staticRows.nth(4).getByRole('button').click();
        await page.waitForTimeout(200);
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
  expect(await details.evaluate((element) => element.getAnimations().length)).toBe(0);
});
