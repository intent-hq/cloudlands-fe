import { expect, test } from '../../../test/ct-test';
import InviteJoinPromptsPreview from './invite-join-prompts.preview.svelte';

for (const width of [420, 900]) {
  test(`an invite awaiting window readiness shows only connecting progress at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 608 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let retries = 0;
    await mount(InviteJoinPromptsPreview, {
      props: {
        progress: { requestId: 'controlled-admission', phase: 'admission' },
        onRetry: () => {
          retries++;
        },
      },
    });
    const progress = page.getByRole('alertdialog');
    await expect(progress).toContainText('Connecting…');
    await expect(progress).not.toContainText(/Multiplayer/i);
    await expect(progress).toHaveAttribute('aria-busy', 'true');
    await expect(progress.getByRole('alert')).toHaveCount(0);
    // Footer Cancel plus the accessible close control; no enable or retry action.
    await expect(progress.getByRole('button')).toHaveCount(2);
    await expect(progress.getByRole('button', { name: /enable|try again/i })).toHaveCount(0);
    const cancel = progress.getByRole('button', { name: 'Cancel', exact: true });
    const box = (await cancel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`admission-continuing-${width}.png`) });
    await cancel.focus();
    await cancel.press('Escape');
    await expect(progress).toHaveCount(0);
    expect(retries).toBe(0);
  });
}

test('a failed readiness step offers Try again once, disables it while busy, and restores focus on cancel', async ({
  mount,
  page,
}) => {
  await page.evaluate(() => {
    const opener = document.createElement('button');
    opener.textContent = 'Open controlled invitation';
    document.body.append(opener);
    opener.focus();
  });
  let retries = 0;
  const component = await mount(InviteJoinPromptsPreview, {
    props: {
      progress: { requestId: 'failed-admission', phase: 'admission' },
      failed: true,
      onRetry: () => {
        retries++;
      },
    },
  });
  const progress = page.getByRole('alertdialog');
  await expect(progress.getByRole('alert')).toBeVisible();
  await expect(progress).not.toContainText(/Multiplayer/i);
  await expect(progress.getByRole('button')).toHaveCount(3);
  const retry = progress.getByRole('button', { name: 'Try again', exact: true });
  await retry.focus();
  await retry.press('Enter');
  await expect.poll(() => retries).toBe(1);
  await component.update({
    props: {
      progress: { requestId: 'failed-admission', phase: 'admission' },
      failed: true,
      busy: true,
    },
  });
  await expect(retry).toBeDisabled();
  await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(progress).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open controlled invitation' })).toBeFocused();
  expect(retries).toBe(1);
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
      previewScene: { scene: 'invite-join-prompts', state: 'notice-gitlab-pin-mismatch' },
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
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await input.press('Escape');
  await input.press('Escape');
  await expect(palette).toHaveCount(0);
  await expect(notice).toHaveCount(0);
});
