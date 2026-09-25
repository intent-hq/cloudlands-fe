import type { Locator } from '@playwright/test';
import { expect } from '../../../../test/ct-test';

export const activityRowSelector =
  '[data-message-content-block="thinking"] [data-chat-operational-row], [data-message-content-block="tool_use"] [data-chat-operational-row]';

export async function openReasoning(fixture: Locator) {
  const group = fixture.getByTestId('response-group-disclosure');
  if ((await group.count()) && (await group.getAttribute('aria-expanded')) === 'false')
    await group.click();
  for (const disclosure of await fixture.getByTestId('reasoning-disclosure').all()) {
    if ((await disclosure.getAttribute('aria-expanded')) === 'false') await disclosure.click();
  }
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
