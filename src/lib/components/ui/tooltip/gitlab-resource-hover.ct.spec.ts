import { expect, test } from '../../../../test/ct-test';
import Harness from './gitlab-resource-hover.test-harness.svelte';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

for (const outcome of ['Resolve old MR', 'Reject old MR']) {
  test(
    'an old MR reply cannot replace the same-IID issue after rapid hover: ' + outcome,
    async ({ mount, page }) => {
      await mount(Harness, { props: { holdFirst: true } });
      await page.getByTestId('mr-link').hover();
      await expect(page.getByRole('tooltip').getByRole('status')).toHaveAttribute(
        'aria-busy',
        'true',
      );
      await page.getByTestId('issue-link').hover();
      const card = page.getByRole('tooltip');
      await expect(card).toContainText('Issue #42');
      await expect(card).toContainText('Preserve issue identity in notes');
      await page.evaluate(
        (action) =>
          window.dispatchEvent(new CustomEvent('resource-hover-control', { detail: action })),
        outcome,
      );
      await expect(card).toContainText('Preserve issue identity in notes');
      await expect(card).not.toContainText('Private obsolete error');
      await expect(page.getByTestId('hover-control')).toHaveAttribute('data-releases', '1');
      await page.evaluate(() => document.fonts.ready);
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(800);
      expect(box!.y + box!.height).toBeLessThanOrEqual(600);
    },
  );
}

for (const action of ['Retire connection', 'Unmount links']) {
  test('settled private facts disappear after ' + action, async ({ mount, page }) => {
    await mount(Harness);
    await page.getByTestId('mr-link').hover();
    await expect(page.getByRole('tooltip')).toContainText('Merge request !42');
    await expect(page.getByTestId('resource-instance')).toHaveText(
      'https://gitlab.example.test:8443/forge',
    );
    await expect(page.getByTestId('resource-project')).toHaveText('Team/Platform/api');
    await page.evaluate(
      (action) =>
        window.dispatchEvent(new CustomEvent('resource-hover-control', { detail: action })),
      action,
    );
    await expect(page.getByText('Keep hover details on the original connection')).toBeHidden();
    await expect(page.getByTestId('hover-control')).toHaveAttribute('data-releases', '1');
  });
}

test('an unverified work item and an unconfigured host remain ordinary links without detail traffic', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await page.getByTestId('work-item-link').hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expect(page.getByTestId('hover-control')).toHaveAttribute('data-captures', '0');
  await page.getByTestId('foreign-link').hover();
  await expect(page.getByTestId('hover-control')).toHaveAttribute('data-releases', '1');
  await expect(page.getByTestId('hover-control')).toHaveAttribute('data-requests', '0');
  await expect(page.getByTestId('foreign-link')).toHaveAttribute('href', /foreign\.example\.test/);
});
