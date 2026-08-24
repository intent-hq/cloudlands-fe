import { expect, test } from '@playwright/experimental-ct-svelte';
import ReasoningHistoryGeometryHost from './ReasoningHistoryGeometryHost.svelte';

test('removes only the unintended gap between adjacent reasoning history blocks', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ReasoningHistoryGeometryHost);
  const fixture = component.getByTestId('history-geometry');
  await fixture.getByTestId('response-group-disclosure').click();

  const children = fixture.locator('[data-response-group-child]');
  await expect(children).toHaveCount(4);
  const geometry = await children.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        type: element.getAttribute('data-message-content-block'),
        top: box.top,
        bottom: box.bottom,
        paddingTop: style.paddingTop,
      };
    }),
  );
  expect(geometry.map(({ type }) => type)).toEqual(['text', 'thinking', 'thinking', 'tool_use']);
  expect(geometry[1].paddingTop).toBe('16px');
  expect(geometry[2].paddingTop).toBe('0px');

  const titles = fixture.getByTestId('reasoning-history-title');
  await expect(titles).toHaveCount(4);
  const titleXs = await titles.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().x),
  );
  const toolX = await fixture
    .locator('[data-message-content-block="tool_use"] [data-tool-sentence]')
    .evaluate((element) => element.getBoundingClientRect().x);
  for (const titleX of titleXs) expect(titleX).toBeCloseTo(toolX, 1);

  const historyRows = fixture.getByTestId('reasoning-history-row');
  const [firstHistoryRowBox, secondHistoryFirstRowBox, descriptionBox, firstHistoryBox] =
    await Promise.all([
      historyRows.first().boundingBox(),
      historyRows.nth(2).boundingBox(),
      children.nth(0).boundingBox(),
      children.nth(1).boundingBox(),
    ]);
  expect(firstHistoryRowBox!.y - (descriptionBox!.y + descriptionBox!.height)).toBeCloseTo(16, 1);
  expect(secondHistoryFirstRowBox!.y - (firstHistoryBox!.y + firstHistoryBox!.height)).toBeCloseTo(
    0,
    1,
  );
  const secondHistory = children.nth(2);
  const lastTitle = secondHistory.getByTestId('reasoning-history-row').last();
  const body = secondHistory.locator('[data-reasoning-history-body]');
  const [lastTitleBox, bodyBox] = await Promise.all([lastTitle.boundingBox(), body.boundingBox()]);
  expect(bodyBox!.y - (lastTitleBox!.y + lastTitleBox!.height)).toBeCloseTo(0, 1);
  expect(await body.evaluate((element) => getComputedStyle(element).paddingTop)).toBe('6px');
  expect(await body.evaluate((element) => getComputedStyle(element).paddingBottom)).toBe('8px');
  const [currentSecondHistoryBox, currentToolBox] = await Promise.all([
    secondHistory.boundingBox(),
    children.nth(3).boundingBox(),
  ]);
  expect(
    currentToolBox!.y - (currentSecondHistoryBox!.y + currentSecondHistoryBox!.height),
  ).toBeCloseTo(0, 1);

  const ordinary = component.getByTestId('ordinary-reasoning-geometry');
  const ordinaryRows = ordinary.getByTestId('reasoning-tool-call');
  await expect(ordinaryRows).toHaveCount(2);
  const ordinaryBoxes = await ordinaryRows.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    }),
  );
  expect(ordinaryBoxes[1].top - ordinaryBoxes[0].bottom).toBeCloseTo(56, 1);
});
