import { expect, test } from '../../../../test/ct-test';
import InitialAgentPicker from './initial-agent-picker.preview.svelte';

for (const width of [1200, 390]) {
  test(`machine search preserves selection and keyboard focus at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 700 });
    await mount(InitialAgentPicker, { props: { state: 'start-on-unreachable' } });
    const trigger = page.getByRole('button', { name: /^Machines / });
    await expect(trigger).toContainText('intent1');
    await trigger.click();
    const popup = page.getByRole('dialog', { name: 'Machines', exact: true });
    const search = popup.getByRole('combobox', { name: 'Machines', exact: true });
    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute('placeholder', 'Search machines');
    await expect(popup).toBeInViewport({ ratio: 1 });
    await expect(popup.getByRole('option', { name: /^Lab PC/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await testInfo.attach('machines', {
      body: await page.screenshot({ path: testInfo.outputPath('machines.png') }),
      contentType: 'image/png',
    });
    await search.fill('Mac');
    await expect(popup.getByRole('option')).toHaveCount(1);
    await search.press('ArrowDown');
    await search.press('Enter');
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText('Mac mini');

    await trigger.press('Enter');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
    await expect(popup.getByRole('option', { name: /^Mac mini/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await popup.getByRole('option', { name: /^intent1(?: |$)/ }).click();
    await expect(popup).toBeHidden();
    await expect(trigger).toContainText('intent1');
    await trigger.click();
    await expect(popup.getByRole('option', { name: /^intent1(?: |$)/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}
