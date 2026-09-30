import { expect, test } from '../../../test/ct-test';
import RetireAgentModal from './RetireAgentModal.svelte';

for (const dismissal of ['Enter', 'Escape', 'outside'] as const) {
  test(`retirement confirmation focuses Cancel and dismisses with ${dismissal} without retiring`, async ({
    mount,
    page,
  }) => {
    let retirements = 0;
    await mount(RetireAgentModal, {
      props: {
        open: true,
        agentName: 'Keyboard fixture',
        onRetire: async () => {
          retirements++;
        },
      },
    });
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeFocused();
    if (dismissal === 'outside') await page.mouse.click(5, 5);
    else await page.keyboard.press(dismissal);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(retirements).toBe(0);
  });
}
