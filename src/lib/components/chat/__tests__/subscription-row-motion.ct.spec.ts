import { expect, test } from '@playwright/experimental-ct-svelte';
import EventWakeupMotionHost from './EventWakeupMotionHost.svelte';

test('uses descriptive ordered headers for small wakes and count-only text for five', async ({
  mount,
}) => {
  const component = await mount(EventWakeupMotionHost);
  const cases = [
    ['one', 'Alpha finished'],
    ['two', 'Alpha finished & Beta failed'],
    ['four', 'Agent 0 completed & Agent 1 completed & Agent 2 completed & Agent 3 completed'],
    ['five', '5 events'],
    ['duplicate', 'Alpha finished'],
    ['unknown', 'Custom unknown'],
    ['attention', 'Alpha is waiting'],
    ['failure', 'Alpha failed'],
  ] as const;

  for (const [scenario, label] of cases) {
    await component.update({ props: { scenario } });
    await expect(component.getByTestId('event-wakeup-summary')).toHaveAttribute(
      'aria-label',
      label,
    );
    await expect(component.getByTestId('event-wakeup-summary').locator('[title]')).toHaveAttribute(
      'title',
      label,
    );
  }
});

test('settles keyed event details after add, remove, reorder, burst, and interrupted motion', async ({
  mount,
  page,
}) => {
  const component = await mount(EventWakeupMotionHost, { props: { scenario: 'motion', count: 4 } });
  await component.getByTestId('event-wakeup-summary').click();
  await expect(component.getByTestId('event-wakeup-detail')).toHaveCount(4);

  await component.update({ props: { scenario: 'motion', count: 2, reverse: true } });
  await component.update({ props: { scenario: 'motion', count: 8, reverse: false } });
  await component.update({ props: { scenario: 'motion', count: 3, reverse: true } });
  await page.waitForTimeout(220);

  const rows = component.getByTestId('event-wakeup-detail');
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((nodes) => nodes.map((node) => node.textContent))).toEqual([
    expect.stringContaining('Agent 2'),
    expect.stringContaining('Agent 1'),
    expect.stringContaining('Agent 0'),
  ]);
  expect(
    await component
      .getByTestId('event-wakeup-details')
      .evaluate((details) =>
        Array.from(details.querySelectorAll('[data-testid="event-wakeup-detail"]')).every(
          (row) => row.getBoundingClientRect().height > 0 && getComputedStyle(row).height !== '0px',
        ),
      ),
  ).toBe(true);
});
