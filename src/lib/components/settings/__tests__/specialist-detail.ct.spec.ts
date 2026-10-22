import { expect, test } from '../../../../test/ct-test';
import SpecialistDetailPreview from '../specialist-detail.preview.svelte';
import { measureText } from './specialist-detail.assertions';

for (const theme of ['light', 'dark'] as const) {
  test(`specialist status and secondary actions meet WCAG text contrast in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.evaluate((value) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(value);
    }, theme);
    const component = await mount(SpecialistDetailPreview);
    const advanced = component.getByRole('button', { name: 'Advanced', exact: true });
    const targets = [
      component.getByText('Modified', { exact: true }),
      component.getByText('Open', { exact: true }),
      advanced,
    ];
    for (const target of targets) {
      const color = await target.evaluate(measureText);
      expect(color.background[3]).toBe(1);
      expect(color.contrast, JSON.stringify(color)).toBeGreaterThanOrEqual(4.5);
    }
    await advanced.click();
    await expect(advanced).toHaveAttribute('aria-expanded', 'true');
    for (const target of [advanced, component.getByRole('button', { name: 'Add model option' })]) {
      const color = await target.evaluate(measureText);
      expect(color.contrast, JSON.stringify(color)).toBeGreaterThanOrEqual(4.5);
    }
    const model = await component.getByText('Model', { exact: true }).evaluate(measureText);
    const muted = await advanced.evaluate(measureText);
    expect(muted.color).not.toBe(model.color);
    expect(Number(muted.weight)).toBeLessThan(Number(model.weight));
  });
}

for (const width of [420, 1440]) {
  test(`specialist detail text and split controls align at ${width}px`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(SpecialistDetailPreview);
    await page.evaluate(() => document.fonts.ready);
    const group = component.locator('[data-open-combo-control]');
    const buttons = group.getByRole('button');
    await expect(buttons).toHaveCount(2);
    const [primary, caret, bounds] = await Promise.all([
      buttons.nth(0).boundingBox(),
      buttons.nth(1).boundingBox(),
      group.boundingBox(),
    ]);
    expect(primary!.height).toBeGreaterThanOrEqual(28);
    expect(caret!.width).toBeGreaterThanOrEqual(28);
    expect(Math.abs(primary!.height - caret!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(primary!.y - caret!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(primary!.x + primary!.width - caret!.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(primary!.x - bounds!.x - 1)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(caret!.x + caret!.width - bounds!.x - bounds!.width + 1)).toBeLessThanOrEqual(
      0.5,
    );
    const divider = await buttons.nth(1).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: parseFloat(style.borderLeftWidth),
        style: style.borderLeftStyle,
        innerRadius: parseFloat(style.borderTopLeftRadius),
      };
    });
    expect(divider.width).toBe(1);
    expect(divider.style).toBe('solid');
    expect(divider.innerRadius).toBe(0);
    const details = component.getByTestId('specialist-details-column');
    const advanced = details.getByRole('button', { name: 'Advanced', exact: true });
    await advanced.click();
    const add = details.getByRole('button', { name: 'Add model option' });
    await expect(add).toBeVisible();
    const leftEdges = await Promise.all([
      details.locator('p').first().evaluate(measureText),
      details.getByText('Model', { exact: true }).evaluate(measureText),
      advanced.evaluate(measureText),
      add.evaluate(measureText),
      details.locator('#specialist-model-options-label').evaluate(measureText),
      details.locator('#specialist-model-options-description').evaluate(measureText),
    ]);
    const xs = leftEdges.map((edge) => edge.x!);
    expect(Math.max(...xs) - Math.min(...xs), JSON.stringify(leftEdges)).toBeLessThanOrEqual(1);
    await add.click();
    await expect(details.getByRole('textbox')).toHaveCount(1);
    const overflow = await details.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const hint = (await details.getByRole('textbox').boundingBox())!;
    const column = (await details.boundingBox())!;
    expect(hint.width).toBeGreaterThanOrEqual(100);
    expect(hint.x + hint.width).toBeLessThanOrEqual(column.x + column.width + 1);
  });
}

test('keyboard activates separate launch, menu and advanced model-option controls safely', async ({
  mount,
  page,
}) => {
  const component = await mount(SpecialistDetailPreview);
  const buttons = component.locator('[data-open-combo-control]').getByRole('button');
  await buttons.nth(0).focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => JSON.parse(await component.getByTestId('editor-launches').innerText()))
    .toEqual([
      {
        channel: 'vscode:open',
        args: [
          {
            folder: '/tmp/intent-demo/specialists',
            file: '/tmp/intent-demo/specialists/review-helper.md',
          },
        ],
      },
    ]);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(buttons.nth(1)).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
  const advanced = component.getByRole('button', { name: 'Advanced', exact: true });
  await advanced.focus();
  await page.keyboard.press('Enter');
  await expect(advanced).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  const add = component.getByRole('button', { name: 'Add model option' });
  await expect(add).toBeFocused();
  await page.keyboard.press('Enter');
  const details = component.getByTestId('specialist-details-column');
  await expect(details.getByRole('textbox')).toHaveCount(1);
  await details.getByRole('button', { name: 'Remove model option' }).focus();
  await page.keyboard.press('Enter');
  await expect(details.getByRole('textbox')).toHaveCount(0);
  await advanced.focus();
  await page.keyboard.press('Space');
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await expect(add).toBeHidden();
});

for (const source of ['user', 'project'] as const) {
  for (const unsupported of [false, true]) {
    test(`imported Claude ${source} agent is read-only with unsupported fields ${unsupported}`, async ({
      mount,
      page,
    }, testInfo) => {
      const component = await mount(SpecialistDetailPreview, {
        props: { imported: true, unsupported, source },
      });
      await expect(component.getByText('Imported from Claude Code', { exact: true })).toBeVisible();
      await expect(
        component.getByText('Read-only in Intent. Open the original file to make changes.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(component.getByRole('textbox')).toHaveCount(1);
      await expect(component.getByRole('textbox')).toHaveAttribute('readonly', '');
      await expect(component.getByRole('button', { name: 'Delete specialist' })).toHaveCount(0);
      await expect(component.getByRole('button', { name: 'Reset', exact: true })).toHaveCount(0);
      await expect(component.getByRole('button', { name: 'Advanced', exact: true })).toHaveCount(0);
      await expect(component.getByRole('combobox')).toHaveCount(0);
      const warning = component.getByTestId('specialist-import-warning');
      if (unsupported) {
        await expect(warning).toContainText('Cannot launch in Intent');
        await expect(warning).toContainText('tools, permissionMode');
      } else {
        await expect(warning).toHaveCount(0);
      }
      const file =
        source === 'project'
          ? '/tmp/intent-demo/.claude/agents/review-helper.md'
          : '/tmp/intent-demo/home/.claude/agents/review-helper.md';
      await component.locator('[data-open-combo-control]').getByRole('button').first().click();
      await expect
        .poll(async () => JSON.parse(await component.getByTestId('editor-launches').innerText()))
        .toEqual([
          {
            channel: 'vscode:open',
            args: [{ folder: file.slice(0, file.lastIndexOf('/')), file }],
          },
        ]);
      await testInfo.attach('imported-specialist', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    });
  }
}

for (const [code, reason] of [
  ['invalid', 'Invalid agent definition'],
  ['unreadable', 'Cannot read agent file'],
  ['broken-link', 'Broken file link'],
  ['too-large', 'Agent file is too large'],
  ['shadowed', 'Another definition takes precedence'],
  ['scan-limit', 'Discovery limit reached'],
] as const) {
  test(`skipped Claude import ${code} is visible with an empty catalog`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(SpecialistDetailPreview, {
      props: { diagnosticCode: code, emptyCatalog: true },
    });
    const panel = component.getByRole('region', { name: 'Claude agent import notices' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(reason, { exact: true })).toBeVisible();
    await expect(panel.getByText('skipped-agent.md', { exact: true })).toBeVisible();
    await expect(
      panel.getByText('/tmp/intent-demo/.claude/agents/skipped-agent.md', { exact: true }),
    ).toHaveCount(0);
    await panel.locator('[data-open-combo-control]').getByRole('button').first().click();
    await expect
      .poll(async () => JSON.parse(await component.getByTestId('editor-launches').innerText()))
      .toEqual([
        {
          channel: 'vscode:open',
          args: [
            {
              folder: '/tmp/intent-demo/.claude/agents',
              file: '/tmp/intent-demo/.claude/agents/skipped-agent.md',
            },
          ],
        },
      ]);
    await testInfo.attach(`diagnostic-${code}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}

for (const isDirectory of [false, true]) {
  test(`diagnostic Open respects remote workspace locality for a ${isDirectory ? 'directory' : 'file'}`, async ({
    mount,
    page,
    context,
  }, testInfo) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const props = {
      diagnosticCode: isDirectory ? ('scan-limit' as const) : ('invalid' as const),
      diagnosticIsDirectory: isDirectory,
      emptyCatalog: true,
      diagnosticWorkspace: 'remote' as const,
    };
    const component = await mount(SpecialistDetailPreview, { props });
    const panel = component.getByRole('region', { name: 'Claude agent import notices' });
    const path = isDirectory
      ? '/tmp/intent-demo/.claude/agents'
      : '/tmp/intent-demo/.claude/agents/skipped-agent.md';
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Open in...' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Copy path', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(path);
    await expect(component.getByTestId('editor-launches')).toHaveText('[]');
    await testInfo.attach('remote-diagnostic-copy-only', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    await component.update({ props: { ...props, diagnosticWorkspace: 'local' } });
    await panel.getByRole('button', { name: 'Open', exact: true }).click();
    await expect
      .poll(async () => JSON.parse(await component.getByTestId('editor-launches').innerText()))
      .toEqual([
        {
          channel: 'vscode:open',
          args: [isDirectory ? path : { folder: path.slice(0, path.lastIndexOf('/')), file: path }],
        },
      ]);
    await testInfo.attach('local-diagnostic-editor', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await component.update({ props });
    await expect(panel.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Copy path', exact: true })).toBeVisible();
  });
}

test('missing Claude skills clear after a catalog refresh without unlocking edits', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SpecialistDetailPreview, {
    props: { imported: true, missingSkills: true, catalogFlow: true },
  });
  const warning = component.getByTestId('specialist-missing-skills');
  await expect(warning).toContainText('absent from this catalog');
  await expect(warning).toContainText('workspace where you launch');
  await expect(warning).toContainText('code-review');
  await expect(component.getByRole('textbox')).toHaveAttribute('readonly', '');
  await testInfo.attach('missing-skills', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await component.getByTestId('restore-required-skill').click();
  await expect(warning).toHaveCount(0);
  await expect(component.getByRole('textbox')).toHaveAttribute('readonly', '');
  await expect(
    component.getByText('/tmp/intent-demo/home/.claude/agents/review-helper.md', { exact: true }),
  ).toHaveCount(0);
  await expect(component.getByRole('region', { name: 'Claude agent import notices' })).toHaveCount(
    0,
  );
  await testInfo.attach('skills-restored', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('live catalog subscription keeps failed reads but clears a successful empty roster', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SpecialistDetailPreview, {
    props: { imported: true, catalogFlow: true },
  });
  await expect(component.getByTestId('catalog-ids')).toHaveText('["preview-detail"]');
  await expect(component.getByTestId('catalog-requests')).toHaveText('1');
  await component.getByTestId('fail-catalog-refresh').click();
  await expect(component.getByTestId('catalog-requests')).toHaveText('2');
  await expect(component.getByTestId('catalog-ids')).toHaveText('["preview-detail"]');
  await component.getByTestId('empty-catalog-refresh').click();
  await expect(component.getByTestId('catalog-requests')).toHaveText('3');
  await expect(component.getByTestId('catalog-ids')).toHaveText('[]');
  const notices = component.getByRole('region', { name: 'Claude agent import notices' });
  await expect(notices.getByText('Invalid agent definition', { exact: true })).toBeVisible();
  await notices.getByText('Details', { exact: true }).click();
  await expect(
    notices.getByText('Repair invalid frontmatter in the original agent file.', { exact: true }),
  ).toBeVisible();
  await expect(component.getByRole('heading', { name: 'Review helper', exact: true })).toHaveCount(
    0,
  );
  await testInfo.attach('empty-catalog-diagnostics', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('directory scan-limit notice opens the directory target', async ({ mount }) => {
  const component = await mount(SpecialistDetailPreview, {
    props: { diagnosticCode: 'scan-limit', diagnosticIsDirectory: true, emptyCatalog: true },
  });
  const panel = component.getByRole('region', { name: 'Claude agent import notices' });
  await expect(panel.getByText('agents', { exact: true })).toBeVisible();
  await panel.locator('[data-open-combo-control]').getByRole('button').first().click();
  await expect
    .poll(async () => JSON.parse(await component.getByTestId('editor-launches').innerText()))
    .toEqual([{ channel: 'vscode:open', args: ['/tmp/intent-demo/.claude/agents'] }]);
});
