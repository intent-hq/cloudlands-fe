import { expect, test } from '../../../../test/ct-test';
import AgentNameCursorPreview from '../agent-name-cursor.preview.svelte';

for (const cursor of ['pointer', 'default'] as const) {
  test(`agent name inherits a ${cursor} row cursor and keeps native rename behavior`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(AgentNameCursorPreview, { props: { cursor } });
    const name = component.getByTestId('agent-card-name');
    await expect(name).toHaveText('Demo developer');
    await expect(name).toHaveCSS('cursor', cursor);
    const row = component.locator('button[data-agent-panel-row]');
    await row.focus();
    await page.keyboard.press('Enter');
    const input = component.getByRole('textbox', { name: 'Rename' });
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS('cursor', 'text');
    await input.fill('Renamed developer');
    await input.press('Enter');
    await expect(name).toHaveText('Renamed developer');
    await expect(name).toHaveCSS('cursor', cursor);
    await name.dblclick();
    await expect(input).toBeFocused();
    await input.fill('Discard this edit');
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(name).toHaveText('Renamed developer');
    await expect(name).toHaveCSS('cursor', cursor);
  });
}
