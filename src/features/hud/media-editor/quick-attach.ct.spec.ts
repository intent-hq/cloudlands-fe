import { expect, test, expectAnimationsToSettle } from '../../../test/ct-test';
import type { Locator, Page } from '@playwright/test';
import Harness from './__fixtures__/QuickAttachHarness.svelte';

const requests = async (fixture: Locator) =>
  JSON.parse((await fixture.getAttribute('data-requests')) ?? '[]') as {
    channel: string;
    request: { openId: string; intent?: 'attach'; edit?: { marks: unknown[] } };
  }[];
async function editText(page: Page, fixture: Locator, kind: 'screenshot' | 'recording') {
  await fixture.getByRole('button', { name: 'Text', exact: true }).click();
  const surface =
    kind === 'screenshot'
      ? fixture.getByRole('application')
      : fixture.locator('.frame-marks svg.surface');
  await expect(surface).toBeVisible();
  if (kind === 'recording') await expect(surface).toHaveAttribute('data-editable', 'true');
  await surface.click({ position: { x: 100, y: 100 } });
  const input = fixture.getByRole('textbox', { name: 'Text', exact: true });
  await input.fill('Local draft');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(input).not.toBeVisible();
  await expect(fixture).toHaveAttribute('data-dirty', 'true');
  await expect(fixture.locator('[data-attach]')).toBeEnabled();
}
for (const kind of ['screenshot', 'recording'] as const) {
  test(`${kind}: clean Attach, removed save shortcut, dirty Save and duplicate guard`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    const fixture = await mount(Harness, {
      props: { kind, admitted: false },
      hooksConfig: { mockBackend: {} },
    });
    const attach = fixture.locator('[data-attach]');
    await expect(attach).toBeEnabled();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(fixture).toHaveAttribute('data-closes', '1');
    expect((await requests(fixture)).filter((x) => x.channel.endsWith(':save'))).toHaveLength(0);
    await fixture.update({ props: { kind, epoch: 1, admitted: true } });
    await editText(page, fixture, kind);
    await page.keyboard.press('ControlOrMeta+s');
    await expect(fixture).toHaveAttribute('data-dirty', 'true');
    expect((await requests(fixture)).filter((x) => x.channel.endsWith(':save'))).toHaveLength(0);
    await expect(fixture).toHaveAttribute('data-closes', '1');
    await fixture.update({ props: { kind, epoch: 1, mode: 'defer' } });
    await attach.click();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(attach).toBeDisabled();
    await expect
      .poll(async () => (await requests(fixture)).filter((x) => x.channel.endsWith(':save')).length)
      .toBe(1);
    await fixture.update({ props: { kind, epoch: 1, mode: 'defer', release: 1 } });
    await expect(fixture).toHaveAttribute('data-closes', '2');
    await info.attach('wire-receipt', {
      body: JSON.stringify(await requests(fixture), null, 2),
      contentType: 'application/json',
    });
  });
  test(`${kind}: failed Attach preserves draft; keyboard Close confirms; stale owner cannot finish`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: 1100, height: 780 });
    const fixture = await mount(Harness, {
      props: { kind, mode: 'fail' },
      hooksConfig: { mockBackend: {} },
    });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await editText(page, fixture, kind);
    await fixture.locator('[data-attach]').click();
    await expect(fixture.getByRole('alert')).toBeVisible();
    await expect(fixture).toHaveAttribute('data-dirty', 'true');
    await expect(fixture).toHaveAttribute('data-closes', '0');
    // An active drawing tool/selection consumes Escape before Close.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await fixture.getByRole('button', { name: 'Close', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Discard changes?' });
    await expect(dialog.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(fixture).toHaveAttribute('data-closes', '0');
    await expectAnimationsToSettle(fixture);
    await page.screenshot({ path: info.outputPath(`${kind}-attach-ready.png`) });
    await fixture.update({ props: { kind, mode: 'defer' } });
    await fixture.locator('[data-attach]').click();
    await fixture.update({ props: { kind, mode: 'defer', principal: 'B', release: 1 } });
    await expect(fixture.getByRole('alert')).toBeVisible();
    await expect(fixture).toHaveAttribute('data-closes', '0');
    await fixture.update({ props: { kind, epoch: 1, mode: 'defer' } });
    await editText(page, fixture, kind);
    await fixture.locator('[data-attach]').click();
    const closeCountBeforeRetarget = (await requests(fixture)).filter((x) =>
      x.channel.endsWith(':close'),
    ).length;
    await fixture.update({ props: { kind, epoch: 2, mode: 'defer', release: 2 } });
    await expect(fixture).toHaveAttribute('data-dirty', 'false');
    await expect(fixture).toHaveAttribute('data-acknowledgements', '3');
    await expect(fixture).toHaveAttribute('data-closes', '0');
    expect((await requests(fixture)).filter((x) => x.channel.endsWith(':close'))).toHaveLength(
      closeCountBeforeRetarget,
    );
    await info.attach('wire-receipt', {
      body: JSON.stringify(await requests(fixture), null, 2),
      contentType: 'application/json',
    });
  });
  test(`${kind}: inline edit shortcuts commit or cancel before attachment`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 780 });
    const fixture = await mount(Harness, { props: { kind }, hooksConfig: { mockBackend: {} } });
    const attach = fixture.locator('[data-attach]');
    async function beginText(fraction: number) {
      await fixture.getByRole('button', { name: 'Text', exact: true }).click();
      const surface =
        kind === 'screenshot'
          ? fixture.getByRole('application')
          : fixture.locator('.frame-marks svg.surface');
      await expect(surface).toBeVisible();
      if (kind === 'recording') await expect(surface).toHaveAttribute('data-editable', 'true');
      const rect = await surface.boundingBox();
      if (!rect) throw new Error('Frame unavailable');
      await page.mouse.click(rect.x + rect.width * fraction, rect.y + rect.height * fraction);
      const input = fixture.getByRole('textbox', { name: 'Text', exact: true });
      await expect(input).toBeVisible();
      await input.fill('Local draft');
      return input;
    }
    await beginText(0.3);
    await expect(attach).toBeDisabled();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(fixture.getByRole('textbox', { name: 'Text', exact: true })).not.toBeVisible();
    await expect(fixture).toHaveAttribute('data-closes', '0');
    await expect(attach).toBeEnabled();
    await page.keyboard.press('ControlOrMeta+s');
    await expect(fixture).toHaveAttribute('data-dirty', 'true');
    expect((await requests(fixture)).filter((x) => x.channel.endsWith(':save'))).toHaveLength(0);
    await expect(fixture).toHaveAttribute('data-closes', '0');
    await beginText(0.6);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(fixture).toHaveAttribute('data-closes', '0');
  });
  test(`${kind}: both close attempts failing leaves a saved capture retryable`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: 1100, height: 780 });
    const fixture = await mount(Harness, {
      props: { kind, closeMode: 'fail' },
      hooksConfig: { mockBackend: {} },
    });
    await editText(page, fixture, kind);
    const attach = fixture.locator('[data-attach]');
    await attach.click();
    await expect(fixture.getByRole('alert')).toHaveText(
      'Could not close the editor. Try Attach again.',
    );
    await expect(attach).toBeEnabled();
    await expect(fixture).toHaveAttribute('data-dirty', 'false');
    await expect(fixture).toHaveAttribute('data-closes', '0');
    expect((await requests(fixture)).filter((x) => x.channel.endsWith(':close'))).toHaveLength(2);
    await fixture.update({ props: { kind, closeMode: 'normal' } });
    await attach.click();
    await expect(fixture).toHaveAttribute('data-closes', '1');
    expect((await requests(fixture)).filter((x) => x.channel.endsWith(':save'))).toHaveLength(1);
    await info.attach('retry-wire-receipt', {
      body: JSON.stringify(await requests(fixture), null, 2),
      contentType: 'application/json',
    });
  });
  test(`${kind}: pending text protects field and native Close; ModW is guarded inside dialogs`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: 1100, height: 780 });
    const fixture = await mount(Harness, { props: { kind }, hooksConfig: { mockBackend: {} } });
    await fixture.getByRole('button', { name: 'Text', exact: true }).click();
    const surface =
      kind === 'screenshot'
        ? fixture.getByRole('application')
        : fixture.locator('.frame-marks svg.surface');
    if (kind === 'recording') await expect(surface).toHaveAttribute('data-editable', 'true');
    const rect = await surface.boundingBox();
    if (!rect) throw new Error('No drawing surface');
    await page.mouse.click(rect.x + rect.width * 0.3, rect.y + rect.height * 0.3);
    const input = fixture.getByRole('textbox', { name: 'Text', exact: true });
    await input.fill('Pending local text');
    await expect(fixture).toHaveAttribute('data-dirty', 'true');
    await page.keyboard.press('ControlOrMeta+w');
    const dialog = page.getByRole('dialog', { name: 'Discard changes?' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('ControlOrMeta+w');
    await expect(dialog).toBeVisible();
    await expect(fixture).toHaveAttribute('data-closes', '0');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await fixture.update({ props: { kind, nativeRequest: 1 } });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('ControlOrMeta+w');
    await expect(fixture).toHaveAttribute('data-discarded', '0');
    await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(fixture).toHaveAttribute('data-kept', '1');
    await expect(fixture).toHaveAttribute('data-closes', '0');
    await info.attach('pending-close-state', {
      body: JSON.stringify(
        {
          dirty: await fixture.getAttribute('data-dirty'),
          discarded: await fixture.getAttribute('data-discarded'),
          requests: await requests(fixture),
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
}
test('screenshot crop cancels before Close; legacy main receives a guarded close fallback', async ({
  mount,
  page,
}, info) => {
  const fixture = await mount(Harness, {
    props: { legacy: true },
    hooksConfig: { mockBackend: {} },
  });
  await fixture.getByRole('button', { name: 'Crop', exact: true }).click();
  await expect(fixture.locator('[data-attach]')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(fixture).toHaveAttribute('data-closes', '0');
  await fixture.locator('[data-attach]').click();
  await expect(fixture).toHaveAttribute('data-closes', '1');
  const closes = (await requests(fixture)).filter((x) => x.channel.endsWith(':close'));
  expect(closes.map((x) => x.request)).toEqual([
    { openId: '00000000-0000-4000-8000-000000000000', intent: 'attach' },
    { openId: '00000000-0000-4000-8000-000000000000' },
  ]);
  await info.attach('legacy-wire-receipt', {
    body: JSON.stringify(closes, null, 2),
    contentType: 'application/json',
  });
});

test('close IPC rejection and timeout release Attach busy state', async ({ mount, page }, info) => {
  const fixture = await mount(Harness, {
    props: { closeMode: 'throw' },
    hooksConfig: { mockBackend: {} },
  });
  const attach = fixture.locator('[data-attach]');
  await expect(attach).toBeEnabled();
  await attach.click();
  await expect(fixture.getByRole('alert')).toBeVisible();
  await expect(attach).toBeEnabled();
  await fixture.update({ props: { epoch: 1, closeMode: 'hang' } });
  await expect(attach).toBeEnabled();
  await page.clock.install();
  await attach.click();
  await expect(attach).toBeDisabled();
  await page.clock.fastForward(5000);
  await expect
    .poll(async () => (await requests(fixture)).filter((x) => x.channel.endsWith(':close')).length)
    .toBe(4);
  await page.clock.fastForward(5000);
  await expect(fixture.getByRole('alert')).toBeVisible();
  await expect(attach).toBeEnabled();
  await expect(fixture).toHaveAttribute('data-closes', '0');
  await info.attach('timeout-wire-receipt', {
    body: JSON.stringify(await requests(fixture), null, 2),
    contentType: 'application/json',
  });
});

test('pending crop is protected by Close and native discard request; clean ModW closes without Attach intent', async ({
  mount,
  page,
}) => {
  const fixture = await mount(Harness, { hooksConfig: { mockBackend: {} } });
  await fixture.getByRole('button', { name: 'Crop', exact: true }).click();
  await expect(fixture).toHaveAttribute('data-dirty', 'true');
  await page.keyboard.press('ControlOrMeta+w');
  const dialog = page.getByRole('dialog', { name: 'Discard changes?' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await fixture.update({ props: { nativeRequest: 1 } });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(fixture).toHaveAttribute('data-kept', '1');
  await expect(fixture).toHaveAttribute('data-discarded', '0');
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(fixture.getByRole('button', { name: 'Crop', exact: true })).toBeVisible();
  await expect(fixture).toHaveAttribute('data-dirty', 'false');
  await page.keyboard.press('ControlOrMeta+w');
  await expect(fixture).toHaveAttribute('data-closes', '1');
  expect(
    (await requests(fixture)).filter((x) => x.channel.endsWith(':close')).map((x) => x.request),
  ).toEqual([{ openId: '00000000-0000-4000-8000-000000000000' }]);
});
