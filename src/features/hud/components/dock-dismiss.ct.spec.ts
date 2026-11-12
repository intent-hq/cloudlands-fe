import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockDismissBrowserHarness.svelte';

test.use({ video: 'on', trace: 'on', contextOptions: { reducedMotion: 'no-preference' } });
const baseline = process.env.DOCK_DISMISS_BASELINE === '1';
type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Shell = ReturnType<Page['getByTestId']>;
async function staysExpanded(shell: Shell, value: boolean, milliseconds: number) {
  await shell.evaluate(
    (node, { value, milliseconds }) =>
      new Promise<void>((resolve, reject) => {
        const check = () => {
          if (node.getAttribute('data-expanded') !== String(value)) {
            observer.disconnect();
            clearTimeout(timer);
            reject(new Error('Disclosure changed during its quiet period'));
          }
        };
        const observer = new MutationObserver(check);
        const timer = setTimeout(() => {
          observer.disconnect();
          resolve();
        }, milliseconds);
        observer.observe(node, { attributes: true, attributeFilter: ['data-expanded'] });
        check();
      }),
    { value, milliseconds },
  );
}

test('hover leave, outside click and Escape release disclosure and its input footprint', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 1000, height: 740 });
  await mount(Harness);
  const shell = page.getByTestId('dock-shell');
  const proof = page.getByTestId('dismiss-proof');
  await page.mouse.move(900, 700);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await page.getByTestId('dock-drag-handle').hover();
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await expect(page.getByRole('textbox', { name: 'Draft' })).toBeFocused();
  await page.mouse.move(900, 700);
  if (baseline) {
    await staysExpanded(shell, true, 900);
    const afterLeave = await shell.getAttribute('data-expanded');
    await page.getByTestId('outside').click();
    await expect(shell).toHaveAttribute('data-expanded', 'false');
    const afterOutside = await shell.getAttribute('data-expanded');
    await page.keyboard.press('Escape');
    await staysExpanded(shell, true, 600);
    const receipt = {
      source: 'ec0b638b5',
      afterLeave,
      afterOutside,
      afterEscape: await shell.getAttribute('data-expanded'),
      commands: JSON.parse((await proof.getAttribute('data-commands')) ?? '[]'),
    };
    await info.attach('baseline.json', {
      body: JSON.stringify(receipt),
      contentType: 'application/json',
    });
    await info.attach('baseline-stuck.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    expect(afterLeave).toBe('true');
    return;
  }
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await page.getByTestId('dock-drag-handle').hover();
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await page.getByRole('textbox', { name: 'Draft' }).press('End');
  await page.keyboard.type(' intact');
  await page.mouse.move(900, 700);
  await staysExpanded(shell, true, 500);
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await page.getByTestId('outside').click();
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await page.getByTestId('dock-drag-handle').hover();
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await page.keyboard.press('Escape');
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await staysExpanded(shell, false, 500);
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await expect(proof).toHaveAttribute('data-workspace', 'synthetic-workspace');
  await expect(proof).toHaveAttribute('data-draft', 'Keep this draft intact');
  await info.attach('dismissal.json', {
    body: JSON.stringify({
      hoverLeave: true,
      outside: true,
      escape: true,
      compact,
      draft: await proof.getAttribute('data-draft'),
      regions: JSON.parse((await proof.getAttribute('data-regions')) ?? '[]'),
    }),
    contentType: 'application/json',
  });
  await info.attach('collapsed.png', { body: await page.screenshot(), contentType: 'image/png' });
});

test('Escape releases first-run overview hold without reopening under a still pointer', async ({
  mount,
  page,
}, info) => {
  test.skip(baseline);
  await page.setViewportSize({ width: 1000, height: 740 });
  await mount(Harness, { props: { intro: true, overview: true } });
  const shell = page.getByTestId('dock-shell');
  await page.getByTestId('dock-drag-handle').hover();
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await page.keyboard.press('Escape');
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await staysExpanded(shell, false, 500);
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await info.attach('overview-escape.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('stationary header pointer stays dismissed and deliberate click or shortcut can reopen', async ({
  mount,
  page,
}, info) => {
  test.skip(baseline);
  await page.setViewportSize({ width: 1000, height: 740 });
  const component = await mount(Harness);
  const shell = page.getByTestId('dock-shell');
  await page.mouse.move(900, 700);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(shell).toHaveAttribute('data-reveal', '0');
  const compact = (await page.getByTestId('dock-surface').boundingBox())!;
  const point = { x: compact.x + 10, y: compact.y + compact.height / 2 };
  await page.mouse.move(point.x, point.y);
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await page.keyboard.press('Escape');
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await staysExpanded(shell, false, 650);
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  const stillInside = await page.getByTestId('dock-surface').evaluate((node, p) => {
    const b = node.getBoundingClientRect();
    return p.x >= b.left && p.x < b.right && p.y >= b.top && p.y < b.bottom;
  }, point);
  expect(stillInside).toBe(true);
  await page.mouse.click(point.x, point.y);
  await expect(shell).toHaveAttribute('data-expanded', 'true', { timeout: 100 });
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await page.keyboard.press('Escape');
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await component.update({ props: { focusRequest: 1 } });
  await expect(shell).toHaveAttribute('data-expanded', 'true', { timeout: 100 });
  await expect(page.getByRole('textbox', { name: 'Draft' })).toBeFocused();
  await info.attach('stationary-reopen.json', {
    body: JSON.stringify({
      point,
      stillInside,
      closedForMs: 650,
      clickReopens: true,
      shortcutReopens: true,
      source: 'isolated',
    }),
    contentType: 'application/json',
  });
  await info.attach('explicit-reopen.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('native menu holds expansion only for the lifetime of the menu', async ({
  mount,
  page,
}, info) => {
  test.skip(baseline);
  await page.setViewportSize({ width: 1000, height: 740 });
  await mount(Harness, { hooksConfig: { mockBackend: {} } });
  await page.mouse.move(900, 700);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '0');
  await page.getByTestId('dock-drag-handle').hover();
  const shell = page.getByTestId('dock-shell');
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await page.getByTestId('dock-drag-handle').click({ button: 'right' });
  await expect(page.getByTestId('finish-menu')).toBeVisible();
  await page.mouse.move(900, 700);
  await staysExpanded(shell, true, 650);
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await page.getByTestId('finish-menu').click();
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await info.attach('menu-lifetime.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

for (const liveMode of ['recording', 'dictation'])
  test(`${liveMode} protects the mounted conversation from passive and outside dismissal`, async ({
    mount,
    page,
  }, info) => {
    test.skip(baseline);
    await page.setViewportSize({ width: 1000, height: 740 });
    const component = await mount(Harness, { props: { liveMode } });
    const shell = page.getByTestId('dock-shell');
    await expect(shell).toHaveAttribute('data-reveal', '1');
    await page.mouse.move(900, 700);
    await page.getByTestId('outside').click();
    await page.keyboard.press('Escape');
    await staysExpanded(shell, true, 600);
    await expect(shell).toHaveAttribute('data-expanded', 'true');
    await expect(page.getByTestId('dismiss-proof')).toHaveAttribute(
      'data-workspace',
      'synthetic-workspace',
    );
    await component.update({ props: { liveMode: '' } });
    await expect(shell).toHaveAttribute('data-reveal', '0');
    await info.attach(`${liveMode}-protected.json`, {
      body: JSON.stringify({
        liveMode,
        stayedMounted: true,
        releasedAfterCompletion: true,
        nativeCapture: false,
      }),
      contentType: 'application/json',
    });
  });
