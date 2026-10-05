import { expect, test } from '../../../../test/ct-test';
import CollectionHarness from './CollectionHarness.svelte';
import CardInsetContractHarness from './CardInsetContractHarness.svelte';
import InterruptedAgentsModal from '../../modals/InterruptedAgentsModal.svelte';

for (const key of ['Enter', 'Space']) {
  test(`${key} activates a nested row action exactly once without selecting the row`, async ({
    mount,
  }) => {
    const component = await mount(CollectionHarness);
    const first = component.getByRole('option').first();
    const action = first.getByRole('button', { name: 'Act on Alpha' });

    await action.press(key);

    await expect(component.getByRole('status', { name: 'Action count' })).toHaveText('1');
    await expect(first).toHaveAttribute('aria-selected', 'false');
  });
}

test('arrow keys in a nested input do not move row focus', async ({ mount }) => {
  const component = await mount(CollectionHarness);
  const first = component.getByRole('option').first();
  const input = first.getByRole('textbox', { name: 'Edit Alpha' });

  await input.focus();
  await input.press('ArrowDown');

  await expect(input).toBeFocused();
});

test('keyboard row focus reveals its actions', async ({ mount }) => {
  const component = await mount(CollectionHarness);
  const first = component.getByRole('option').first();
  const actions = first.locator('[data-slot="row-actions"]');

  await first.focus();

  await expect(actions).toHaveCSS('opacity', '1');
});

test('an open overflow menu keeps row actions revealed', async ({ mount, page }) => {
  const component = await mount(CollectionHarness);
  const first = component.getByRole('option').first();
  const actions = first.locator('[data-slot="row-actions"]');

  const overflow = first.getByRole('button', { name: 'More actions for Alpha' });
  await overflow.focus();
  await overflow.press('Enter');

  await expect(page.getByRole('menu', { name: 'More actions for Alpha' })).toBeVisible();
  await expect(actions).toHaveCSS('opacity', '1');
});

test('selectable modal rows toggle after pointer hover without reactive loops', async ({
  mount,
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mount(InterruptedAgentsModal, {
    props: {
      open: true,
      inline: true,
      agents: [
        {
          agentId: 'a1',
          workspaceId: 'w1',
          workspaceName: 'Workspace',
          agentName: 'Agent',
          prevStatus: 'responding',
          interruptedAt: '2026-08-22T10:00:00Z',
        },
      ],
    },
  });
  const option = page
    .getByRole('alertdialog')
    .getByRole('checkbox', { name: 'Workspace', exact: true });
  await option.hover();
  await option.click();
  await expect(option).not.toBeChecked();
  await option.press('Space');
  await expect(option).toBeChecked();
  await option.press('Enter');
  // Checkbox semantics toggle on Space, not Enter.
  await expect(option).toBeChecked();
  await option.press('Space');
  await expect(option).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('card row hover and selection keep a gutter while text stays aligned', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(CardInsetContractHarness);
  const row = component.getByRole('option');
  const card = component.locator('[data-slot="card-content"]');
  const assertGutter = async (selector: string) => {
    await expect
      .poll(async () => {
        const outer = await card.boundingBox();
        const highlight = await component.locator(selector).boundingBox();
        if (!outer || !highlight) return null;
        return [highlight.x - outer.x, outer.x + outer.width - highlight.x - highlight.width];
      })
      .toEqual([8, 8]);
    await expect(component.locator(selector)).toHaveCSS('border-radius', '8px');
  };
  await row.hover();
  await assertGutter('.bg-hover');
  await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await assertGutter('.bg-selected');
  const title = await component.locator('[data-slot="card-title"]').boundingBox();
  const text = await row.getByText('Active workspace').boundingBox();
  const empty = component.locator('[data-slot="empty-state-description"]');
  const emptyBox = await empty.boundingBox();
  expect(title).not.toBeNull();
  expect(text?.x).toBe(title?.x);
  expect(emptyBox?.x).toBe(title?.x);
  await expect(empty).toHaveCSS('font-size', '13px');
});
