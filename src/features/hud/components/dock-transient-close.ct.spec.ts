import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockShortcutToggleHarness.svelte';

/**
 * Closing the open dock (the open shortcut again, Escape, a click outside) only collapses
 * it: the shell asks main to release the keyboard, never to Hide the dock. Main treats
 * `dismiss` as the dock's own Hide (it closes the window, saves the dock as off and drops
 * the global shortcuts), so a transient close must not send it. Through the real DockRail
 * and AdaptiveDockShell, many open/close cycles leave the collapsed rail in place.
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } });

type Command = { action: string };

test('six open/close shortcut cycles collapse the dock without ever hiding it', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 1000, height: 740 });
  await page.mouse.move(900, 700);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const component = await mount(Harness);
  const shell = page.getByTestId('dock-shell');
  const draft = page.getByRole('textbox', { name: 'Draft' });
  const proof = page.getByTestId('dismiss-proof');
  const commands = async () =>
    JSON.parse((await proof.getAttribute('data-commands')) ?? '[]') as Command[];
  await expect(shell).toHaveAttribute('data-reveal', '0');
  const cycles: Record<string, unknown>[] = [];
  let request = 0;
  for (let cycle = 1; cycle <= 6; cycle++) {
    await component.update({ props: { closeRequest: ++request } });
    await expect(shell).toHaveAttribute('data-expanded', 'true');
    await expect(draft).toBeFocused();
    await component.update({ props: { closeRequest: ++request } });
    await expect(shell).toHaveAttribute('data-reveal', '0');
    // The collapsed rail is still there for the next press.
    await expect(page.getByTestId('dock-surface')).toBeVisible();
    cycles.push({ cycle, hides: (await commands()).filter((c) => c.action === 'dismiss').length });
  }
  await expect(proof).toHaveAttribute('data-draft', 'Keep this draft');
  const sent = await commands();
  expect(sent.filter((c) => c.action === 'dismiss')).toEqual([]);
  expect(sent.filter((c) => c.action === 'release').length).toBeGreaterThanOrEqual(6);
  await writeFile(
    info.outputPath('transient-close-cycles.json'),
    JSON.stringify({ cycles, sent: sent.map((c) => c.action) }, null, 2),
  );
});

for (const how of ['Escape', 'a click outside'] as const) {
  test(`${how} collapses the open dock without hiding it`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 1000, height: 740 });
    await page.mouse.move(900, 700);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const component = await mount(Harness);
    const shell = page.getByTestId('dock-shell');
    const proof = page.getByTestId('dismiss-proof');
    await expect(shell).toHaveAttribute('data-reveal', '0');
    await component.update({ props: { closeRequest: 1 } });
    await expect(shell).toHaveAttribute('data-expanded', 'true');
    if (how === 'Escape') await page.keyboard.press('Escape');
    else await page.mouse.click(40, 700);
    await expect(shell).toHaveAttribute('data-reveal', '0');
    await expect(page.getByTestId('dock-surface')).toBeVisible();
    const sent = JSON.parse((await proof.getAttribute('data-commands')) ?? '[]') as Command[];
    expect(sent.filter((c) => c.action === 'dismiss')).toEqual([]);
    expect(sent.some((c) => c.action === 'release')).toBe(true);
  });
}
