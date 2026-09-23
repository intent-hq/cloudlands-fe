// protocol-version-ok-file: intentionally mismatched fixture versions exercise advisory UI.
import { expect, test } from '../../../../test/ct-test';
import type { Locator, Page, TestInfo } from '@playwright/experimental-ct-svelte';
import type { ConnectionProtocolMismatchEvent } from '$shared/types/connections';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ModalStackingHarness from './ModalStackingHarness.svelte';
import ProtocolMismatchModal from '../ProtocolMismatchModal.svelte';

test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });

async function capture(page: Page, testInfo: TestInfo) {
  await page.evaluate(() => document.fonts.ready);
  const geometry = await page
    .locator('[role="dialog"], [role="alertdialog"]')
    .evaluateAll((dialogs) =>
      dialogs.map((dialog) => {
        const rect = dialog.getBoundingClientRect();
        const style = getComputedStyle(dialog);
        return {
          title: dialog.querySelector('h2')?.textContent?.trim(),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          zIndex: style.zIndex,
          pointerEvents: style.pointerEvents,
          ownsFocus: dialog.contains(document.activeElement),
          hitAtCenter: dialog.contains(
            document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
          ),
        };
      }),
    );
  const dir = resolve(process.env.MODAL_STACK_EVIDENCE ?? testInfo.outputDir);
  await mkdir(dir, { recursive: true });
  const name = testInfo.title.replace(/[^a-z0-9]+/gi, '-');
  await writeFile(resolve(dir, `${name}.json`), JSON.stringify(geometry, null, 2));
  await page.screenshot({ path: resolve(dir, `${name}.png`) });
}

async function ownsFocus(dialog: Locator) {
  await expect
    .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);
}

async function hitTest(button: Locator) {
  return button.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return node.contains(
      document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
    );
  });
}

for (const updateKind of ['quit', 'release-notes'] as const) {
  for (const first of ['protocol', 'update'] as const) {
    test(`${updateKind}: ${first} first restores covered dialog after top closes`, async ({
      mount,
      page,
    }, testInfo) => {
      const component = await mount(ModalStackingHarness, {
        props: { updateKind, protocolOpen: first === 'protocol', updateOpen: first === 'update' },
      });
      const protocol = page.getByRole('dialog', { name: 'Protocol version differs', exact: true });
      const update =
        updateKind === 'quit'
          ? page.getByRole('alertdialog')
          : page.locator('[role="dialog"].release-notes-dialog');
      const bottom = first === 'protocol' ? protocol : update;
      const top = first === 'protocol' ? update : protocol;
      const dismiss = (dialog: Locator) =>
        dialog.getByRole('button', {
          name:
            dialog === protocol ? 'Continue anyway' : updateKind === 'quit' ? 'Cancel' : 'Got it',
          exact: true,
        });
      await expect(bottom).toBeVisible();
      await page.keyboard.press('Tab');
      await component.update({ props: { protocolOpen: true, updateOpen: true } });
      await expect(top).toBeVisible();
      await capture(page, testInfo);

      // Independent oracle: the last-arriving dialog must be both hit-testable and focused.
      await expect.poll(() => hitTest(dismiss(top))).toBe(true);
      await ownsFocus(top);
      for (const key of ['Tab', 'Shift+Tab']) {
        for (let i = 0; i < 4; i++) {
          await page.keyboard.press(key);
          await ownsFocus(top);
        }
      }

      const actions = page.getByTestId('modal-stacking-actions');
      const updateDismissals =
        updateKind === 'quit' ? 'data-quit-cancels' : 'data-release-dismissals';
      const reopenTop = async () => {
        await component.update({
          props: first === 'protocol' ? { updateOpen: false } : { protocolOpen: false },
        });
        await expect(top).toHaveCount(0);
        await component.update({
          props: first === 'protocol' ? { updateOpen: true } : { protocolOpen: true },
        });
        await ownsFocus(top);
      };

      await dismiss(top).click();
      await expect(top).toHaveCount(0);
      await expect(bottom).toBeVisible();
      await ownsFocus(bottom);
      await expect.poll(() => hitTest(dismiss(bottom))).toBe(true);
      await expect(actions).toHaveAttribute(updateDismissals, first === 'protocol' ? '1' : '0');

      await reopenTop();
      await page.keyboard.press('Escape');
      await expect(top).toHaveCount(0);
      await expect(bottom).toBeVisible();
      await ownsFocus(bottom);
      await expect.poll(() => hitTest(dismiss(bottom))).toBe(true);
      await expect(actions).toHaveAttribute(updateDismissals, first === 'protocol' ? '2' : '0');

      await reopenTop();
      const coveredBox = await dismiss(bottom).boundingBox();
      if (!coveredBox) throw new Error('Covered action has no geometry');
      await page.mouse.click(
        coveredBox.x + coveredBox.width / 2,
        coveredBox.y + coveredBox.height / 2,
      );
      await expect(bottom).toBeVisible();
      await expect(actions).toHaveAttribute('data-quit-proceeds', '0');
      await expect(actions).toHaveAttribute('data-background', '0');
      if (first === 'update') {
        await expect(actions).toHaveAttribute(updateDismissals, '0');
      }

      // An exposed covered action may hit the top backdrop and dismiss only the top.
      // Reopen to verify a background pointer cannot act through either layer.
      await reopenTop();
      await page.mouse.click(40, 40);
      await expect(bottom).toBeVisible();
      await expect(actions).toHaveAttribute('data-background', '0');
      await reopenTop();
      await page.keyboard.press('Escape');
      await expect(top).toHaveCount(0);
      await expect(bottom).toBeVisible();
      await ownsFocus(bottom);
      await dismiss(bottom).click();
      await expect(page.locator('[role="dialog"], [role="alertdialog"]')).toHaveCount(0);
      await page.getByRole('button', { name: 'Background action' }).click();
      await expect(actions).toHaveAttribute('data-background', '1');
      await expect(actions).toHaveAttribute('data-quit-proceeds', '0');
    });
  }
}

test('standalone protocol notice supports native dismissal and open-local callback', async ({
  mount,
  page,
}) => {
  let continued = 0;
  let openedLocal = 0;
  const event: ConnectionProtocolMismatchEvent = {
    id: 'demo',
    host: 'demo.invalid',
    port: 443,
    localProtocolVersion: '1.0',
    remoteProtocolVersion: '2.0',
    origin: 'switch',
  };
  const props = {
    event,
    onContinue: () => {
      continued++;
    },
    onOpenLocal: () => {
      openedLocal++;
    },
  };
  const component = await mount(ProtocolMismatchModal, { props });
  await ownsFocus(page.getByRole('dialog'));
  await page.getByRole('button', { name: 'Open This machine (local)', exact: true }).click();
  await expect.poll(() => openedLocal).toBe(1);
  expect(continued).toBe(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => continued).toBe(1);
  await component.unmount();

  for (const [index, action] of ['Continue anyway', 'Close', 'backdrop'].entries()) {
    const notice = await mount(ProtocolMismatchModal, { props });
    await ownsFocus(page.getByRole('dialog'));
    if (action === 'backdrop') await page.mouse.click(40, 40);
    else await page.getByRole('button', { name: action, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.click(40, 40);
    await expect.poll(() => continued).toBe(index + 2);
    await notice.unmount();
  }
  expect(openedLocal).toBe(1);
});
