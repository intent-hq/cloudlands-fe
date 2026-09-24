import type { Locator } from '@playwright/test';
import { expect, test } from '../../../../test/ct-test';

export const activityRowSelector =
  '[data-message-content-block="thinking"] [data-chat-operational-row], [data-message-content-block="tool_use"] [data-chat-operational-row]';

export async function settleReasoning(fixture: Locator) {
  await fixture.evaluate(async (root) => {
    await document.fonts.ready;
    await Promise.all(
      root
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    );
  });
}

export async function openReasoning(fixture: Locator) {
  const group = fixture.getByTestId('response-group-disclosure');
  if ((await group.count()) && (await group.getAttribute('aria-expanded')) === 'false')
    await group.click();
  for (const disclosure of await fixture.getByTestId('reasoning-disclosure').all()) {
    if ((await disclosure.getAttribute('aria-expanded')) === 'false') await disclosure.click();
  }
  await settleReasoning(fixture);
}

export async function recordReasoningGeometry(fixture: Locator, name: string) {
  await settleReasoning(fixture);
  const geometry = await fixture.locator(activityRowSelector).evaluateAll((rows) =>
    rows.map((row, index) => {
      const box = row.querySelector('[data-operational-disclosure-row]')!.getBoundingClientRect();
      const summary = row.querySelector<HTMLElement>('[data-operational-summary]');
      const icon = row.querySelector<HTMLElement>('[data-operational-leading] svg');
      const previous = rows[index - 1]
        ?.querySelector('[data-operational-disclosure-row]')
        ?.getBoundingClientRect();
      return {
        type: row
          .closest('[data-message-content-block]')
          ?.getAttribute('data-message-content-block'),
        text: summary?.textContent?.trim(),
        top: box.top,
        bottom: box.bottom,
        height: box.height,
        gap: previous ? box.top - previous.bottom : null,
        summaryX: summary?.getBoundingClientRect().x,
        iconWidth: icon?.getBoundingClientRect().width,
      };
    }),
  );
  await test.info().attach(`${name}-geometry`, {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  });
  console.log(`${name}: ${JSON.stringify(geometry)}`);
  return geometry;
}

export async function captureReasoning(fixture: Locator, name: string) {
  await test.info().attach(name, { body: await fixture.screenshot(), contentType: 'image/png' });
}

export async function assertContentOnceInOrder(fixture: Locator, expected: string[]) {
  // Markdown parsing updates asynchronously after the renderer receives a delta.
  // Wait for the actual supplied content, not just the enclosing Svelte mount.
  for (const value of expected) {
    await expect
      .poll(async () => ((await fixture.textContent()) ?? '').split(value).length - 1, {
        message: `Exactly one rendered occurrence of ${value}`,
      })
      .toBe(1);
  }
  const text = (await fixture.textContent()) ?? '';
  let previous = -1;
  for (const value of expected) {
    expect(text.split(value), value).toHaveLength(2);
    expect(text.indexOf(value), value).toBeGreaterThan(previous);
    previous = text.indexOf(value);
  }
}

export async function thinkingBoundaryGap(fixture: Locator) {
  const geometry = await fixture
    .locator('[data-message-content-block="thinking"]')
    .evaluateAll((blocks) => {
      const previous = blocks[blocks.length - 2];
      const nextRow = blocks[blocks.length - 1].querySelector('[data-chat-operational-row]')!;
      const previousBottom = previous.getBoundingClientRect().bottom;
      const nextTop = nextRow.getBoundingClientRect().top;
      return { previousBottom, nextTop, gap: nextTop - previousBottom };
    });
  await test.info().attach('thinking-block-boundary', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  return geometry.gap;
}
