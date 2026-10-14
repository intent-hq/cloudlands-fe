import { test, expect, openFixture } from '../lib/functional.mjs';

test('composer queue: native keyboard and pointer reorder preserve rows and focus', async ({
  page,
}, info) => {
  const fixture = await openFixture(page, 'message-composer', 'queued-messages');
  const first = fixture.getByRole('button', {
    name: 'Summarize the implementation plan',
    exact: true,
  });
  const second = fixture.getByRole('button', { name: 'Then identify the main risks', exact: true });
  const rows = fixture.locator('[data-message-composer-queue-list] [role="button"]');
  await first.press('Alt+ArrowDown');
  await expect(rows.first()).toHaveAccessibleName('Then identify the main risks');
  await expect(first).toBeFocused();
  await first.press('Alt+ArrowUp');
  await expect(rows.first()).toHaveAccessibleName('Summarize the implementation plan');
  await expect(first).toBeFocused();
  await first.dragTo(second);
  await expect(rows.first()).toHaveAccessibleName('Then identify the main risks');
  await expect(rows).toHaveCount(2);
  await info.attach('composer-reordered-queue', {
    body: await fixture.screenshot(),
    contentType: 'image/png',
  });
});
