import { expect, test } from '../../../test/ct-test';
import RetireAgentModalHarness from './__tests__/RetireAgentModalHarness.svelte';

for (const dismissal of ['Cancel', 'Enter', 'Escape', 'outside'] as const) {
  test(`retirement confirmation focuses Cancel and dismisses with ${dismissal} without retiring`, async ({
    mount,
    page,
  }) => {
    const intents: unknown[] = [];
    await mount(RetireAgentModalHarness, {
      props: {
        onRequested: (payload) => intents.push(payload),
      },
    });
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeFocused();
    if (dismissal === 'outside') await page.mouse.click(5, 5);
    else if (dismissal === 'Cancel') await cancel.click();
    else await page.keyboard.press(dismissal);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(intents).toEqual([]);
  });
}

test('explicit keyboard confirmation emits one scoped retirement intent', async ({
  mount,
  page,
}) => {
  const intents: unknown[] = [];
  await mount(RetireAgentModalHarness, {
    props: { onRequested: (payload) => intents.push(payload) },
  });
  const confirm = page.getByRole('button', { name: 'Retire Agent', exact: true });
  await confirm.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => intents)
    .toEqual([
      [
        'retire-keyboard-workspace',
        expect.any(String),
        expect.any(String),
        'retire-keyboard-agent',
        { kind: 'retire' },
      ],
    ]);
  await expect(confirm).toBeDisabled();
});
