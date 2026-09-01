import { expect, test, type Locator } from '@playwright/experimental-ct-svelte';
import StyleInvalidationHost from './StyleInvalidationHost.svelte';

async function transitionProperties(locator: Locator): Promise<string[]> {
  return locator.evaluate((element) =>
    getComputedStyle(element)
      .transitionProperty.split(',')
      .map((property) => property.trim()),
  );
}

async function expectTransitions(locator: Locator, expected: string[]) {
  expect(new Set(await transitionProperties(locator))).toEqual(new Set(expected));
}

test('limits rendered transitions to paint and compositor properties', async ({ mount }) => {
  const component = await mount(StyleInvalidationHost);

  await expectTransitions(component.getByTestId('comment-highlight'), [
    'background-color',
    'border-bottom-color',
    'transform',
  ]);
  await expectTransitions(component.getByTestId('tool-call'), ['opacity']);
  await expectTransitions(component.getByTestId('mention-chip'), ['background-color']);
  await expectTransitions(component.getByTestId('tab').getByRole('tab'), [
    'background-color',
    'color',
    'border-color',
    'box-shadow',
  ]);
  await expectTransitions(component.getByTestId('tab').getByRole('button'), [
    'background-color',
    'color',
    'border-color',
    'box-shadow',
    'transform',
  ]);
  await expectTransitions(component.getByTestId('collapsible').locator('.text-subtle'), [
    'opacity',
    'transform',
  ]);
  await expectTransitions(component.getByTestId('paint-only-utility'), [
    'background-color',
    'box-shadow',
  ]);
});
