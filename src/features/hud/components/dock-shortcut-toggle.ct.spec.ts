import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockShortcutToggleHarness.svelte';

/**
 * The open-dock shortcut, pressed while the dock already has the keyboard, reaches the dock
 * as a close request (main classifies focus before any native focusing). Through the real
 * DockRail and AdaptiveDockShell, as the dock page renders them: a collapsed dock opens and
 * focuses its prompt, an open one closes as Escape would, and live input keeps it open.
 * The draft always stays.
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } });

async function collapsedStart(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
  await page.setViewportSize({ width: 1000, height: 740 });
  await page.mouse.move(900, 700);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
}

test('the open shortcut toggles the dock: collapsed opens and focuses, open closes, live stays', async ({
  mount,
  page,
}, info) => {
  await collapsedStart(page);
  const component = await mount(Harness);
  const shell = page.getByTestId('dock-shell');
  const draft = page.getByRole('textbox', { name: 'Draft' });
  const proof = page.getByTestId('dismiss-proof');
  await expect(shell).toHaveAttribute('data-reveal', '0');
  const steps: Record<string, unknown>[] = [];

  // Focused but collapsed: the press opens the dock and focuses its prompt.
  await component.update({ props: { closeRequest: 1 } });
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await expect(draft).toBeFocused();
  steps.push({ case: 'focused+collapsed', expanded: await shell.getAttribute('data-expanded') });

  // Focused and open: the press closes it as Escape would; the draft stays.
  await component.update({ props: { closeRequest: 2 } });
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await expect(proof).toHaveAttribute('data-draft', 'Keep this draft');
  steps.push({ case: 'focused+expanded', reveal: await shell.getAttribute('data-reveal') });

  // Open in the background (a normal open request): it stays open.
  await component.update({ props: { focusRequest: 1 } });
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await component.update({ props: { focusRequest: 2 } });
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await expect(draft).toBeFocused();
  steps.push({ case: 'background+expanded', expanded: await shell.getAttribute('data-expanded') });

  // Live dictation: the press changes nothing.
  await component.update({ props: { liveMode: 'dictation', closeRequest: 3 } });
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await expect(proof).toHaveAttribute('data-draft', 'Keep this draft');
  steps.push({ case: 'live', expanded: await shell.getAttribute('data-expanded') });

  await writeFile(
    info.outputPath('shortcut-toggle-receipt.json'),
    JSON.stringify({ steps }, null, 2),
  );
});

test('while a recording runs, the open shortcut on the collapsed dock changes nothing', async ({
  mount,
  page,
}, info) => {
  await collapsedStart(page);
  const component = await mount(Harness, { props: { recordingLive: true } });
  const shell = page.getByTestId('dock-shell');
  const proof = page.getByTestId('dismiss-proof');
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await component.update({ props: { recordingLive: true, closeRequest: 1 } });
  // Two settled frames: the guarded press neither opens nor closes anything.
  await page.waitForFunction(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))),
      ),
  );
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await expect(proof).toHaveAttribute('data-draft', 'Keep this draft');
  await writeFile(
    info.outputPath('shortcut-toggle-guard-receipt.json'),
    JSON.stringify({ recording: 'stayed collapsed', draft: 'kept' }, null, 2),
  );
});
