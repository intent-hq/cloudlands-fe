import { expect, test } from '../../../test/ct-test';
import InviteJoinPromptsPreview from './invite-join-prompts.preview.svelte';

test('Multiplayer recovery preserves the invitation while explicit enable search has keyboard focus', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 420, height: 608 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let retries = 0;
  await mount(InviteJoinPromptsPreview, {
    props: {
      progress: { requestId: 'controlled-recovery', phase: 'admission' },
      onRetry: () => {
        retries++;
      },
    },
  });
  const recovery = page.getByRole('alertdialog');
  await expect(recovery).toContainText('Enable Multiplayer to join');
  await expect(recovery).toContainText('five minutes');
  await page.screenshot({ path: testInfo.outputPath('multiplayer-invite-recovery.png') });
  await recovery.getByRole('button', { name: 'Find Multiplayer', exact: true }).click();
  await expect(recovery).toHaveCount(0);
  const palette = page.getByRole('dialog');
  const input = palette.getByRole('textbox');
  await expect(input).toHaveValue('Multiplayer');
  await expect(input).toBeFocused();
  await expect(
    palette.getByRole('button', { name: /Enable experimental Multiplayer/i }),
  ).toBeVisible();
  await expect(
    palette.getByRole('button', { name: /Disable experimental Multiplayer/i }),
  ).toHaveCount(0);
  expect(retries).toBe(0);
  await input.press('Escape');
  await input.press('Escape');
  await expect(palette).toHaveCount(0);
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: 'Retry invitation', exact: true }).click();
  await expect.poll(() => retries).toBe(1);
  await recovery.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(recovery).toHaveCount(0);
});

test('host consent names host-wide access and keeps cancellation available during joining', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 420, height: 608 });
  await mount(InviteJoinPromptsPreview, {
    props: {
      consent: {
        requestId: 'controlled-host-fixture',
        mode: 'confirm',
        scope: 'host',
        hostLabel: 'Shared Studio',
        workspaceTitle: '',
        login: null,
        identity: { provider: 'gitlab', host: 'gitlab.example' },
      },
    },
  });
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Join Shared Studio?');
  await expect(dialog).toContainText('all current and future workspaces');
  await expect(dialog).toContainText('Host administration stays with the owner');
  await expect(dialog).toContainText('gitlab.example');
  await expect(dialog).toContainText('Saved account');
  await expect(dialog).toContainText('saved personal credential');
  await expect(dialog).not.toContainText('snippet');
  await page.screenshot({ path: testInfo.outputPath('host-consent.png') });
  await dialog.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Join', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('confirmed GitLab recovery opens focused command search without activating the feature', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 608 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(InviteJoinPromptsPreview, {
    props: {
      notice: {
        requestId: 'recovery',
        kind: 'failed',
        reason: 'pin-mismatch',
        accountProvider: 'gitlab',
      },
    },
    hooksConfig: {
      geometrySnapshot: { scene: 'invite-join-prompts', state: 'notice-gitlab-pin-mismatch' },
    },
  });
  const notice = page.getByRole('alertdialog');
  await notice.getByRole('button', { name: /GitLab/ }).click();
  await expect(notice).toHaveCount(0);
  const palette = page.getByRole('dialog');
  const input = palette.getByRole('textbox');
  await expect(input).toHaveValue('GitLab');
  await expect(input).toBeFocused();
  const enable = palette.getByRole('button', { name: /Enable experimental GitLab/i });
  await expect(enable).toBeVisible();
  await expect(palette.getByRole('button', { name: /Disable experimental GitLab/i })).toHaveCount(
    0,
  );
  const box = (await palette.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(420);
  expect(box.y + box.height).toBeLessThanOrEqual(608);
  await input.press('Escape');
  await input.press('Escape');
  await expect(palette).toHaveCount(0);
  await expect(notice).toHaveCount(0);
});
