import { expect, test } from '../../../test/ct-test';
import InviteJoinPromptsPreview from './invite-join-prompts.preview.svelte';

for (const width of [420, 900]) {
  test(`Multiplayer recovery enables once and remains keyboard cancellable at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 608 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let enables = 0;
    const component = await mount(InviteJoinPromptsPreview, {
      props: {
        progress: { requestId: 'controlled-recovery', phase: 'admission' },
        onEnable: () => {
          enables++;
        },
      },
    });
    const recovery = page.getByRole('alertdialog');
    const enable = recovery.getByRole('button', { name: 'Enable Multiplayer', exact: true });
    const cancel = recovery.getByRole('button', { name: 'Cancel', exact: true });
    // Two footer actions plus the accessible close control.
    await expect(recovery.getByRole('button')).toHaveCount(3);
    await enable.focus();
    await enable.press('Tab');
    await expect(recovery.getByRole('button', { name: /dismiss|cancel/i }).first()).toBeFocused();
    await enable.focus();
    await enable.press('Enter');
    await expect.poll(() => enables).toBe(1);
    await cancel.focus();
    await component.update({
      props: {
        progress: { requestId: 'controlled-recovery', phase: 'admission' },
        busy: true,
      },
    });
    await expect(enable).toBeDisabled();
    await expect(cancel).toBeEnabled();
    await expect(recovery).toHaveAttribute('aria-busy', 'true');
    await cancel.focus();
    await cancel.press('Tab');
    await expect(
      recovery.getByRole('button', { name: 'Cancel joining', exact: true }),
    ).toBeFocused();
    await cancel.focus();
    const box = (await enable.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(608);
    await page.screenshot({ path: testInfo.outputPath(`multiplayer-recovery-${width}.png`) });
    await cancel.press('Escape');
    await expect(recovery).toHaveCount(0);
    expect(enables).toBe(1);
  });
}

test('failed recovery keeps both actions usable and restores keyboard focus on cancellation', async ({
  mount,
  page,
}) => {
  await page.evaluate(() => {
    const opener = document.createElement('button');
    opener.textContent = 'Open controlled invitation';
    document.body.append(opener);
    opener.focus();
  });
  let enables = 0;
  await mount(InviteJoinPromptsPreview, {
    props: {
      progress: { requestId: 'failed-recovery', phase: 'admission' },
      failed: true,
      onEnable: () => {
        enables++;
      },
    },
  });
  const recovery = page.getByRole('alertdialog');
  await expect(recovery.getByRole('alert')).toBeVisible();
  await expect(recovery.getByRole('button')).toHaveCount(3);
  const enable = recovery.getByRole('button', { name: 'Enable Multiplayer', exact: true });
  await enable.focus();
  await enable.press('Enter');
  await expect.poll(() => enables).toBe(1);
  await recovery.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(recovery).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open controlled invitation' })).toBeFocused();
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
