import { expect, test } from '../../../../test/ct-test';
import StreamingStatusFailureGeometryHost from './StreamingStatusFailureGeometryHost.svelte';

for (const width of [240, 720]) {
  test(`long failure details and recovery controls remain usable at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(StreamingStatusFailureGeometryHost, {
      props: { width, longError: true },
    });
    const details = component.getByRole('button', { name: 'Details', exact: true });
    await details.focus();
    await details.press('Enter');
    await expect(component.getByTestId('failure-raw-details')).toBeVisible();
    expect(
      await component.getByRole('alert').evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    for (const button of await component.getByRole('button').all()) {
      await expect(button).toBeInViewport();
    }
    await component.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(component).toHaveAttribute('data-retry-count', '1');
  });
}

test('keyboard copy retains focus in forced colors and copies raw diagnostics', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as typeof window & { copiedFailureText?: string }).copiedFailureText = value;
        },
      },
    }),
  );
  const component = await mount(StreamingStatusFailureGeometryHost, {
    props: { width: 240, zoom: 2 },
  });
  const details = component.getByRole('button', { name: 'Details', exact: true });
  await details.focus();
  await details.press('Enter');
  const copy = component.getByRole('button', { name: /Copy details|Copied!/ });
  await copy.focus();
  await copy.press('Enter');
  await expect(copy).toBeFocused();
  await expect(copy).toHaveAccessibleName('Copied!');
  expect(
    await page.evaluate(
      () => (window as typeof window & { copiedFailureText?: string }).copiedFailureText,
    ),
  ).toBe('Provider stopped the response');
});
