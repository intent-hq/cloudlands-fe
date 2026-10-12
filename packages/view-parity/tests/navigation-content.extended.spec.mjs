import {
  test,
  expect,
  openContent,
  nav,
  excerpt,
  frame,
  field,
  button,
  toggle,
  observations,
  callback,
  oracle,
  capture,
  detached,
  snippetFileButton,
  choose,
  expectCode,
  expectNumberedRows,
  expectHit,
  clipboardPermission,
  nativeCopy,
  outputJson,
} from '../lib/navigation-content.mjs';

test('navigation content NC5: canonical highlight waits for real host completion and reads the current target', async ({
  page,
}, info) => {
  const host = nav(await openContent(page));
  const targetFrame = frame(host, 'navigation-link');
  const source = await oracle(page, info);
  const modelTarget = '/settings#%64efault-model';
  const appearanceTarget = '/settings?tab=display#theme';
  const modelId = source.highlight(modelTarget);
  const appearanceId = source.highlight(appearanceTarget);
  const modelToken = field(host, `${modelId} highlight token`);
  const appearanceToken = field(host, `${appearanceId} highlight token`);
  const modelBefore = Number(await modelToken.textContent());
  const appearanceBefore = Number(await appearanceToken.textContent());
  await toggle(host, 'Hold navigation completion', true);
  await field(host, 'Navigation target').fill(modelTarget);
  const started = await callback(host, 'navigation', 'onNavigate', () =>
    targetFrame.getByRole('link').click(),
  );
  expect(started.record.arguments).toEqual([modelTarget]);
  expect(started.record.held).toBe(true);
  await expect(button(host, 'Complete oldest navigation')).toBeEnabled();
  await capture(page, targetFrame, 'navigation-pending', info);
  await expect(modelToken).toHaveText(String(modelBefore));
  await expect(appearanceToken).toHaveText(String(appearanceBefore));
  await field(host, 'Navigation target').fill(appearanceTarget);
  await button(host, 'Replace navigation callbacks').click();
  await button(host, 'Complete oldest navigation').click();
  await expect(appearanceToken).toHaveText(String(appearanceBefore + 1));
  await expect(modelToken).toHaveText(String(modelBefore));
  await expect(button(host, 'Complete oldest navigation')).toBeDisabled();
  await capture(page, targetFrame, 'navigation-current-highlight-request', info);
  await toggle(host, 'Hold navigation completion', false);
  await field(host, 'Navigation target').fill(modelTarget);
  const current = await callback(
    host,
    'navigation',
    'onNavigate',
    () => targetFrame.getByRole('link').press('Enter'),
    { revision: 1 },
  );
  expect(current.record.arguments).toEqual([modelTarget]);
  await expect(modelToken).toHaveText(String(modelBefore + 1));
  await expect(appearanceToken).toHaveText(String(appearanceBefore + 1));
  await info.attach('canonical-highlight-requests.json', {
    body: JSON.stringify(
      {
        modelId,
        appearanceId,
        modelBefore,
        appearanceBefore,
        modelAfter: Number(await modelToken.textContent()),
        appearanceAfter: Number(await appearanceToken.textContent()),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  // This proves the canonical request and public consumer, not production routing or pulse styling.
});

test('navigation content NC6: native listener rebinding remount and narrow keyboard access remain usable', async ({
  page,
}, info) => {
  const host = nav(await openContent(page));
  const targetFrame = frame(host, 'navigation-link');
  await field(host, 'Navigation target').fill(
    `intent://local/file/${'deep-directory/'.repeat(14)}example.ts`,
  );
  await field(host, 'Navigation label').fill('Open excerpt');
  const first = await targetFrame.getByRole('link').elementHandle();
  try {
    await capture(page, targetFrame, 'lifetime-before', info);
    await field(host, 'Navigation target').fill('/specialists');
    await expect(targetFrame.getByRole('link')).toHaveCount(0);
    await detached(first);
    await targetFrame.getByText('Open excerpt', { exact: true }).click();
    expect((await observations(host, 'navigation')).counts.onOpenLink ?? 0).toBe(0);
    await field(host, 'Navigation target').fill('intent://local/note/spec');
    await callback(host, 'navigation', 'onOpenLink', () => targetFrame.getByRole('link').click());
    const second = await targetFrame.getByRole('link').elementHandle();
    try {
      await button(host, 'Remount navigation link').click();
      await detached(second);
      const link = targetFrame.getByRole('link');
      for (let count = 0; count < 4; count++) {
        await page.keyboard.press('Tab');
        if (await link.evaluate((node) => document.activeElement === node)) break;
      }
      await expect(link).toBeFocused();
      await expectHit(page, link, targetFrame, info, 'navigation-narrow-hit');
      const result = await callback(host, 'navigation', 'onOpenLink', () => link.press('Enter'), {
        mount: 1,
      });
      expect(result.observations.counts.onOpenLink).toBe(2);
      const third = await link.elementHandle();
      try {
        await toggle(host, 'Mount navigation link', false);
        await detached(third);
        await expect(targetFrame.getByRole('link')).toHaveCount(0);
        await toggle(host, 'Mount navigation link', true);
        const remounted = await callback(
          host,
          'navigation',
          'onOpenLink',
          () => targetFrame.getByRole('link').click(),
          { mount: 1 },
        );
        expect(remounted.observations.counts.onOpenLink).toBe(3);
      } finally {
        await third.dispose();
      }
    } finally {
      await second.dispose();
    }
    await capture(page, targetFrame, 'lifetime-after', info);
  } finally {
    await first.dispose();
  }
});

test('navigation content NC9: optional and latest excerpt callbacks survive genuine mount lifetimes', async ({
  page,
}, info) => {
  const host = excerpt(await openContent(page));
  const targetFrame = frame(host, 'code-excerpt');
  const file = snippetFileButton(host);
  const first = await targetFrame.locator('code').elementHandle();
  try {
    await capture(page, targetFrame, 'excerpt-lifetime-before', info);
    await toggle(host, 'Pass excerpt file callback', false);
    await file.press('Enter');
    expect((await observations(host, 'excerpt')).counts.onOpenFile ?? 0).toBe(0);
    await toggle(host, 'Pass excerpt file callback', true);
    await field(host, 'Excerpt path').fill('src/latest.ts:42');
    await button(host, 'Replace excerpt callback').click();
    const latest = await callback(host, 'excerpt', 'onOpenFile', () => file.press('Space'), {
      revision: 1,
    });
    expect(latest.record.arguments).toEqual([
      {
        path: 'src/latest.ts:42',
        openInAdjacentPanel: false,
        sourcePanelId: 'catalog-inner-panel',
      },
    ]);
    expect(await first.evaluate((node) => node.isConnected)).toBe(true);
    await button(host, 'Remount code excerpt').click();
    await detached(first);
    const second = await targetFrame.locator('code').elementHandle();
    try {
      await callback(host, 'excerpt', 'onOpenFile', () => file.click(), { revision: 1, mount: 1 });
      await toggle(host, 'Mount code excerpt', false);
      await detached(second);
      await expect(file).toHaveCount(0);
      await toggle(host, 'Mount code excerpt', true);
      const mounted = await callback(host, 'excerpt', 'onOpenFile', () => file.click(), {
        revision: 1,
        mount: 1,
      });
      expect(mounted.observations.counts.onOpenFile).toBe(3);
    } finally {
      await second.dispose();
    }
    await capture(page, targetFrame, 'excerpt-lifetime-after', info);
  } finally {
    await first.dispose();
  }
});

test('navigation content NC10: excerpt defaults mode and line number controls preserve the real code rows', async ({
  page,
}, info) => {
  const host = excerpt(await openContent(page));
  const targetFrame = frame(host, 'code-excerpt');
  await capture(page, targetFrame, 'defaults-before', info);
  await button(host, 'Omit all excerpt props').click();
  await expectCode(targetFrame, '');
  await expectNumberedRows(targetFrame, [1], info, 'default-empty-row');
  await snippetFileButton(host).press('Enter');
  expect((await observations(host, 'excerpt')).counts.onOpenFile ?? 0).toBe(0);
  const code = 'const first = "one";\n\nconst third = "three";';
  await field(host, 'Excerpt code').fill(code);
  await toggle(host, 'Pass excerpt code', true);
  await expectCode(targetFrame, code);
  await expectNumberedRows(targetFrame, [1, 2, 3], info, 'default-three-rows');
  await choose(host, 'Excerpt line numbers', 'false');
  await expectCode(targetFrame, code);
  expect(
    await targetFrame.evaluate((root) =>
      [...root.querySelectorAll('div')]
        .filter((node) => !node.children.length && /^\d+$/.test(node.textContent))
        .map((node) => node.textContent),
    ),
  ).toEqual([]);
  await choose(host, 'Excerpt line numbers', 'true');
  await expectNumberedRows(targetFrame, [1, 2, 3], info, 'restored-three-rows');
  await toggle(host, 'Pass excerpt mode', true);
  for (const mode of ['COMPLETE', 'EXCERPT', '']) {
    await field(host, 'Excerpt mode').fill(mode);
    await expect(targetFrame.getByText('COMPLETE', { exact: true })).toHaveCount(
      mode === 'COMPLETE' ? 1 : 0,
    );
    await expect(targetFrame.getByText('EXCERPT', { exact: true })).toHaveCount(0);
    await expectCode(targetFrame, code);
  }
  await capture(page, targetFrame, 'defaults-after', info);
});

test('navigation content NC11: literal excerpt text and real asynchronous replacements remain current', async ({
  page,
}, info) => {
  const host = excerpt(await openContent(page));
  const targetFrame = frame(host, 'code-excerpt');
  await capture(page, targetFrame, 'code-before', info);
  const code = field(host, 'Excerpt code');
  const literal =
    '<section title="& quoted">\n<script>window.shouldNotRun = true</script>\n</section>\n';
  await field(host, 'Excerpt language').fill('plaintext');
  await code.fill(literal);
  await expectCode(targetFrame, literal);
  await capture(page, targetFrame, 'code-literal', info);
  await field(host, 'Excerpt language').fill('javascript');
  await code.fill('const previous = "superseded";');
  const latest = 'const current = "日本語 & <current>";\nconsole.log(current);';
  await code.fill(latest);
  await expectCode(targetFrame, latest);
  await expect.poll(() => targetFrame.locator('code span').count()).toBeGreaterThan(0);
  await capture(page, targetFrame, 'code-current-highlighted', info);
  await expectCode(targetFrame, latest);
  await toggle(host, 'Mount code excerpt', false);
  await code.fill('const remounted = "latest after disposal";');
  await toggle(host, 'Mount code excerpt', true);
  await expectCode(targetFrame, 'const remounted = "latest after disposal";');
  await capture(page, targetFrame, 'code-remounted', info);
  // Genuine scheduling is unmodified; no forced out-of-order completion claim.
});

test('navigation content NC12: native clipboard paste and narrow keyboard controls preserve exact excerpt content', async ({
  page,
  context,
}, info) => {
  await clipboardPermission(context);
  const host = excerpt(await openContent(page));
  const targetFrame = frame(host, 'code-excerpt');
  const paste = field(host, 'Paste copied excerpt');
  await field(host, 'Excerpt path').fill(
    `${'deep-directory/'.repeat(12)}long-excerpt-file.ts:100-120`,
  );
  const file = snippetFileButton(host);
  await button(host, 'Remount code excerpt').click();
  await page.keyboard.press('Tab');
  await expect(file).toBeFocused();
  await expectHit(page, file, targetFrame, info, 'excerpt-narrow-file');
  await page.keyboard.press('Tab');
  const copy = targetFrame.getByRole('button', { name: 'Copy', exact: true });
  await expect(copy).toBeFocused();
  await targetFrame.hover();
  await expectHit(page, copy, targetFrame, info, 'excerpt-narrow-copy');
  await capture(page, targetFrame, 'clipboard-before', info);
  const samples = [
    'const raw = "✓ & <literal>";\n\nconsole.log(raw);\n',
    '',
    `const full = "${'unbroken-source-'.repeat(60)}雪";`,
  ];
  for (let index = 0; index < samples.length; index++) {
    await field(host, 'Excerpt code').fill(samples[index]);
    await expectCode(targetFrame, samples[index]);
    await nativeCopy(
      page,
      targetFrame,
      paste,
      samples[index],
      ['Enter', 'Space', undefined][index],
    );
    const receipts = await outputJson(field(host, 'Code excerpt clipboard receipts'));
    expect(receipts.receipts.at(-1)).toMatchObject({
      kind: 'native',
      type: 'paste',
      isTrusted: true,
      text: samples[index],
      target: { testId: 'code-excerpt-paste-target' },
    });
    expect(receipts.receipts).toHaveLength(index + 1);
  }
  await expectHit(page, file, targetFrame, info, 'excerpt-long-file');
  await expectHit(page, copy, targetFrame, info, 'excerpt-long-copy');
  await capture(page, targetFrame, 'clipboard-full-after', info);
});
