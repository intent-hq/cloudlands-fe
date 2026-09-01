import { expect, test, type Locator, type Page } from '@playwright/experimental-ct-svelte';
import ToggleHarness from './toggle.test-harness.svelte';

async function resolveTokenColor(
  page: Page,
  property: 'backgroundColor' | 'borderColor' | 'color',
  token: '--primary' | '--primary-foreground',
) {
  return page.evaluate(
    ({ propertyName, tokenName }) => {
      const probe = document.createElement('span');
      probe.style[propertyName] = `hsl(var(${tokenName}))`;
      document.body.append(probe);
      const resolved = getComputedStyle(probe)[propertyName];
      probe.remove();
      return resolved;
    },
    { propertyName: property, tokenName: token },
  );
}

async function expectPrimaryPressedState(toggle: Locator, page: Page) {
  await expect(toggle).toHaveCSS(
    'background-color',
    await resolveTokenColor(page, 'backgroundColor', '--primary'),
  );
  await expect(toggle).toHaveCSS(
    'border-color',
    await resolveTokenColor(page, 'borderColor', '--primary'),
  );
  await expect(toggle).toHaveCSS(
    'color',
    await resolveTokenColor(page, 'color', '--primary-foreground'),
  );
}

test('binds pressed state and activates with Space and Enter', async ({ mount }) => {
  const component = await mount(ToggleHarness);
  const toggle = component.getByRole('button', { name: 'Product updates' });
  const value = component.getByTestId('toggle-value');

  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(value).toHaveText('true');

  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(value).toHaveText('false');

  await component.update({ props: { disabled: true } });
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('uses primary theme tokens while pressed in light and dark themes', async ({
  mount,
  page,
}) => {
  const component = await mount(ToggleHarness, { props: { pressed: true, size: 'xs' } });
  const toggle = component.getByRole('button', { name: 'Product updates' });

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.toggle('light', selectedTheme === 'light');
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
    }, theme);
    await expectPrimaryPressedState(toggle, page);
    await toggle.hover();
    await expectPrimaryPressedState(toggle, page);
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const transitionDurations = await toggle.evaluate((element) =>
    getComputedStyle(element)
      .transitionDuration.split(',')
      .map((duration) => Number.parseFloat(duration)),
  );
  expect(Math.max(...transitionDurations)).toBeLessThanOrEqual(0.00001);
});
