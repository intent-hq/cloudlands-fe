// Deliberately flaky evidence control, outside the default src/ discovery root.
import { test, expect } from '../../src/test/ct-test';
import Harness from '../../src/test/fixtures/CtBrowserHarness.svelte';

test('original failure evidence survives a passing retry', async ({ mount, page }, testInfo) => {
  const component = await mount(Harness, { props: { label: 'Evidence control', step: 2 } });
  await page.getByRole('button').click();
  await expect(page.getByRole('button')).toHaveText('Evidence control: 2');
  await component.unmount();
  expect(testInfo.retry, 'Intentional first-attempt failure for artifact retention').toBe(1);
});
