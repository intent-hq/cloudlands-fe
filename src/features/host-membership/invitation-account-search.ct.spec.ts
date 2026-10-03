import { expect, test } from '../../test/ct-test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import Harness from './__tests__/HostMembershipHarness.svelte';

// Both forge layouts are reviewed at the narrow dialog limit and ordinary desktop width.
for (const provider of ['github', 'gitlab'] as const) {
  for (const width of [390, 960]) {
    test(`${provider} account suggestions support keyboard selection at ${width}px`, async ({
      mount,
      page,
    }) => {
      const host = provider === 'github' ? 'github.com' : 'forge.example:8443';
      await page.setViewportSize({ width, height: 900 });
      await mount(Harness, {
        props: { autocomplete: true, confirmationRevalidation: true },
        hooksConfig: {
          mockBackend: {
            'host.members.list': { members: [], revision: 1 },
            'host.invite.list': { invites: [] },
            'host.invite.searchAccounts': {
              users: [
                {
                  identity: { provider, host, externalUserId: '42' },
                  login: 'sam',
                  name: 'Sam Example',
                  avatarUrl: null,
                },
                {
                  identity: { provider, host, externalUserId: '43' },
                  login: 'sam-team',
                  name: 'Sam Engineering Team',
                  avatarUrl: null,
                },
              ],
            },
          },
        },
      });
      const invite = page.getByRole('button', { name: 'Invite a host member', exact: true });
      await invite.click();
      const dialog = page.getByRole('dialog', { name: 'Invite to this instance' });
      if (provider === 'gitlab') {
        await page.getByRole('combobox', { name: 'Identity provider' }).click();
        await page.getByRole('option', { name: /GitLab/ }).click();
        await page.getByLabel('GitLab instance').fill(host);
      }
      const input = page.getByRole('combobox', { name: 'Account username' });
      await input.fill('sa');
      await expect(page.getByRole('option', { name: 'Sam Example · @sam' })).toBeVisible();
      await expect(input).toBeFocused();
      if (process.env.COLLABORATION_CAPTURE_DIR) {
        await mkdir(process.env.COLLABORATION_CAPTURE_DIR, { recursive: true });
        await page.screenshot({
          path: join(
            process.env.COLLABORATION_CAPTURE_DIR,
            `autocomplete-${provider}-${width}.png`,
          ),
        });
      }
      await input.press('Escape');
      await expect(page.getByRole('option', { name: /@sam/ })).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect(input).toBeFocused();
      await input.fill('sam');
      await expect(page.getByRole('option', { name: 'Sam Example · @sam' })).toBeVisible();
      await input.press('ArrowDown');
      await input.press('Enter');
      await expect(page.getByRole('group', { name: 'Account username' })).toContainText('@sam');
      await expect(dialog.getByRole('button', { name: 'Create invite link' })).toBeDisabled();
      await expect(dialog.getByRole('checkbox')).not.toBeChecked();
      await dialog.getByRole('checkbox').check();
      await expect(dialog.getByRole('button', { name: 'Create invite link' })).toBeEnabled();
      await page
        .getByTestId('suspend-authority')
        .evaluate((node) => (node as HTMLButtonElement).click());
      await expect(dialog.getByRole('button', { name: 'Create invite link' })).toBeDisabled();
      await page
        .getByTestId('restore-authority')
        .evaluate((node) => (node as HTMLButtonElement).click());
      await expect(dialog.getByRole('button', { name: 'Create invite link' })).toBeEnabled();
      await expect(page.getByLabel('Account username')).toHaveValue('sam');
      await expect(page.getByRole('option', { name: /@sam/ })).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(invite).toBeFocused();
      await invite.click();
      await expect(page.getByLabel('Account username')).toHaveValue('');
      await expect(page.getByRole('checkbox')).not.toBeChecked();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(1);
    });
  }
}
